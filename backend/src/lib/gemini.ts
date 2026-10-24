import { GoogleGenAI } from "@google/genai";
import type { AppConfig } from "../config/env.js";

/**
 * Gemini access lives only on the backend. The key never reaches the browser.
 * Callers must send only a minimal, de-identified summary that the app has
 * already calculated — never PDFs, raw statement text, or account details.
 */
export type GeminiService = {
  isEnabled: boolean;
  generateText: (prompt: string) => Promise<string>;
};

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
    generateText: async (prompt) => {
      const response = await client.models.generateContent({
        model: config.geminiModel,
        contents: prompt,
      });
      return response.text ?? "";
    },
  };
}

export class AiUnavailableError extends Error {
  constructor() {
    super("AI explanations are currently unavailable.");
    this.name = "AiUnavailableError";
  }
}
