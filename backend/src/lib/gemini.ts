import { GoogleGenAI } from "@google/genai";
import type { AppConfig } from "../config/env.js";

/**
 * Gemini access lives only on the backend. The key never reaches the browser.
 * Callers must send only a minimal, de-identified summary that the app has
 * already calculated — never PDFs, raw statement text, or account details.
 */
export type GeminiService = {
  isEnabled: boolean;
  generateText: (prompt: string, options?: { system?: string; timeoutMs?: number }) => Promise<string>;
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
    };
  }

  const client = new GoogleGenAI({ apiKey: config.geminiApiKey });

  return {
    isEnabled: true,
    generateText: async (prompt, options = {}) => {
      const timeoutMs = options.timeoutMs ?? 25_000;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new AiUnavailableError("The AI service took too long to answer.")), timeoutMs);
      });
      const request = () =>
        client.models.generateContent({
          model: config.geminiModel,
          contents: prompt,
          config: {
            systemInstruction: options.system,
            temperature: 0.3,
            maxOutputTokens: 700,
          },
        });
      // One retry when Gemini is briefly overloaded (503).
      const withRetry = async () => {
        try {
          return await request();
        } catch (error) {
          if ((error as { status?: number })?.status !== 503) throw error;
          await new Promise((resolve) => setTimeout(resolve, 1500));
          return request();
        }
      };
      try {
        const response = await Promise.race([withRetry(), timeout]);
        const text = response.text?.trim();
        if (!text) throw new AiUnavailableError("The AI service didn't return an answer.");
        return text;
      } catch (error) {
        if (error instanceof AiUnavailableError) throw error;
        const status = (error as { status?: number })?.status;
        throw new AiUnavailableError(
          status === 429 ? "The AI service is busy or out of quota. Try again later." : "The AI service is unavailable right now.",
        );
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
