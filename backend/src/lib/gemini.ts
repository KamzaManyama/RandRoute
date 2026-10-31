import { GoogleGenAI } from "@google/genai";
import type { AppConfig } from "../config/env.js";

/**
 * Gemini access lives only on the backend. The key never reaches the browser.
 * Callers must send only a minimal, de-identified summary that the app has
 * already calculated (see ai/coachInput.ts) — never PDFs, raw statement text,
 * transaction descriptions or account details.
 */
export type GeminiService = {
  isEnabled: boolean;
  /**
   * Asks for a JSON answer that follows `schema` (a JSON Schema object) and
   * returns it parsed. The caller still validates it — the model's output is
   * never trusted as-is.
   */
  generateJson: (prompt: string, options: { system: string; schema: Record<string, unknown>; timeoutMs?: number }) => Promise<unknown>;
};

export class AiUnavailableError extends Error {
  constructor(message = "AI explanations are currently unavailable.") {
    super(message);
    this.name = "AiUnavailableError";
  }
}

export function createGeminiService(config: AppConfig["ai"]): GeminiService {
  if (!config.enabled || !config.geminiApiKey) {
    return {
      isEnabled: false,
      generateJson: async () => {
        throw new AiUnavailableError();
      },
    };
  }

  const client = new GoogleGenAI({ apiKey: config.geminiApiKey });

  return {
    isEnabled: true,
    generateJson: async (prompt, options) => {
      // Main model first; if it's busy, retired or slow, try the backup model once.
      const models = [config.geminiModel, config.geminiFallbackModel].filter((m): m is string => Boolean(m));
      const perAttemptMs = options.timeoutMs ?? 45_000;
      let lastError: unknown;

      for (const model of models) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { status: 504 })), perAttemptMs);
          });
          const response = await Promise.race([
            client.models.generateContent({
              model,
              contents: prompt,
              config: {
                systemInstruction: options.system,
                temperature: 0.3,
                maxOutputTokens: 4096,
                responseMimeType: "application/json",
                responseJsonSchema: options.schema,
              },
            }),
            timeout,
          ]);
          const text = response.text?.trim();
          if (text) {
            try {
              return JSON.parse(text) as unknown;
            } catch {
              lastError = new Error("invalid JSON");
              continue; // try the backup model
            }
          }
          lastError = new Error("empty answer");
        } catch (error) {
          lastError = error;
          const status = (error as { status?: number })?.status;
          // Only fall back for "try somewhere else" problems, not bad requests.
          if (status !== undefined && ![404, 429, 500, 503, 504].includes(status)) break;
        } finally {
          clearTimeout(timer);
        }
      }

      // Log the status only: never the prompt or the answer.
      const status = (lastError as { status?: number })?.status;
      console.warn(`[ai] Gemini failed (${status ?? "no status"}) for models: ${models.join(", ")}`);
      throw new AiUnavailableError(
        status === 504
          ? "The AI service took too long to answer."
          : status === 429
            ? "The AI service is busy or out of quota. Try again later."
            : "The AI service is unavailable right now.",
      );
    },
  };
}
