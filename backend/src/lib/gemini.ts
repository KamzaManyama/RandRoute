import { GoogleGenAI } from "@google/genai";
import type { AppConfig } from "../config/env.js";

/**
 * Gemini access lives only on the backend. The key never reaches the browser.
 * Callers must send only a minimal, de-identified summary that the app has
 * already calculated — never PDFs, raw statement text, or account details.
 */
export type StreamEvent = { type: "thought" | "text"; text: string };

export type GeminiService = {
  isEnabled: boolean;
  generateText: (prompt: string, options?: { system?: string; timeoutMs?: number }) => Promise<string>;
  /**
   * Streams the model's thought summaries and then its answer. Tries the
   * thinking model first; if it fails before sending anything, falls back to
   * the main model (answer only, no thoughts).
   */
  streamText: (
    prompt: string,
    options: { system?: string; signal?: AbortSignal; onEvent: (event: StreamEvent) => void; onModel?: (model: string, thinking: boolean) => void },
  ) => Promise<string>;
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
      generateText: async () => {
        throw new AiUnavailableError();
      },
      streamText: async () => {
        throw new AiUnavailableError();
      },
    };
  }

  const client = new GoogleGenAI({ apiKey: config.geminiApiKey });

  return {
    isEnabled: true,
    generateText: async (prompt, options = {}) => {
      // Main model first; if it's busy, retired or slow, try the backup model once.
      const models = [config.geminiModel, config.geminiFallbackModel].filter((m): m is string => Boolean(m));
      const perAttemptMs = options.timeoutMs ?? 30_000;
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
              config: { systemInstruction: options.system, temperature: 0.3, maxOutputTokens: 1200 },
            }),
            timeout,
          ]);
          const text = response.text?.trim();
          if (text) return text;
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

    streamText: async (prompt, options) => {
      const attempts: { model: string; thinking: boolean }[] = [];
      if (config.geminiThinkingModel) attempts.push({ model: config.geminiThinkingModel, thinking: true });
      for (const model of [config.geminiModel, config.geminiFallbackModel]) {
        if (model && !attempts.some((a) => a.model === model)) attempts.push({ model, thinking: false });
      }

      const FIRST_TOKEN_MS = 30_000; // give up on a model that hasn't started answering
      const TOTAL_MS = 120_000;
      const startedAt = Date.now();
      let lastError: unknown;

      for (const attempt of attempts) {
        if (options.signal?.aborted) throw new AiUnavailableError("Cancelled.");
        let sentAnything = false;
        let answer = "";
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          options.onModel?.(attempt.model, attempt.thinking);
          const firstToken = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { status: 504 })), FIRST_TOKEN_MS);
          });
          const stream = await Promise.race([
            client.models.generateContentStream({
              model: attempt.model,
              contents: prompt,
              config: {
                systemInstruction: options.system,
                temperature: 0.3,
                // Thinking counts towards the output limit, so leave plenty of room for the answer.
                maxOutputTokens: attempt.thinking ? 8192 : 2000,
                ...(attempt.thinking ? { thinkingConfig: { includeThoughts: true, thinkingBudget: 2048 } } : {}),
                abortSignal: options.signal,
              },
            }),
            firstToken,
          ]);

          const iterator = stream[Symbol.asyncIterator]();
          let finishReason: string | undefined;
          while (true) {
            const next = await Promise.race([iterator.next(), firstToken]);
            if (next.done) break;
            if (Date.now() - startedAt > TOTAL_MS) throw Object.assign(new Error("timeout"), { status: 504 });
            finishReason = next.value.candidates?.[0]?.finishReason ?? finishReason;
            for (const part of next.value.candidates?.[0]?.content?.parts ?? []) {
              if (!part.text) continue;
              if (!sentAnything) {
                sentAnything = true;
                clearTimeout(timer); // it's answering — no more first-token deadline
              }
              if (part.thought) options.onEvent({ type: "thought", text: part.text });
              else {
                answer += part.text;
                options.onEvent({ type: "text", text: part.text });
              }
            }
          }
          if (answer.trim()) return answer.trim();
          console.warn(`[ai] ${attempt.model} ended without an answer (finish reason: ${finishReason ?? "unknown"})`);
          lastError = new Error("empty answer");
          if (sentAnything) break; // it thought but never answered; don't repeat thinking with another model
        } catch (error) {
          lastError = error;
          if (sentAnything) break; // can't restart halfway through an answer the user is reading
          const status = (error as { status?: number })?.status;
          if (status !== undefined && ![404, 429, 500, 503, 504].includes(status)) break;
        } finally {
          clearTimeout(timer);
        }
      }

      const status = (lastError as { status?: number })?.status;
      console.warn(`[ai] Gemini stream failed (${status ?? "no status"})`);
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
