import { describe, expect, it } from "vitest";
import {
  aiModelSelectionSchema,
  aiProviderInputSchema,
  aiProviders,
  setAiProviderKeyInputSchema,
  updateAiModelSelectionInputSchema,
} from "../src/index";

describe("AI provider contracts", () => {
  const selection = { source: "local", modelId: "writer", modelName: "Writer" };

  it.each(["visual", "text"])("accepts an independent %s model update", (purpose) => {
    expect(updateAiModelSelectionInputSchema.parse({ purpose, selection })).toEqual({
      purpose,
      selection,
    });
  });

  it("rejects missing or unknown roles and attempts to overwrite both roles in one update", () => {
    for (const input of [
      { selection },
      { purpose: "audio", selection },
      { purpose: "text", selection, visual: selection },
      { purpose: "visual", selection: { ...selection, extra: true } },
    ]) {
      expect(updateAiModelSelectionInputSchema.safeParse(input).success).toBe(false);
    }
  });

  it("offers OpenRouter alongside the direct providers", () => {
    expect([...aiProviders]).toEqual(["anthropic", "openai", "google", "openrouter"]);
  });

  it("accepts OpenRouter selections and keys under the strict IPC schemas", () => {
    expect(
      aiModelSelectionSchema.parse({
        source: "api",
        provider: "openrouter",
        modelId: "router/vision-pro",
        modelName: "Vision Pro",
      }),
    ).toEqual({
      source: "api",
      provider: "openrouter",
      modelId: "router/vision-pro",
      modelName: "Vision Pro",
    });
    expect(setAiProviderKeyInputSchema.parse({ provider: "openrouter", key: "secret" })).toEqual({
      provider: "openrouter",
      key: "secret",
    });
    expect(aiProviderInputSchema.parse({ provider: "openrouter" })).toEqual({
      provider: "openrouter",
    });
  });

  it("rejects unknown providers and extra payload fields", () => {
    expect(() =>
      aiModelSelectionSchema.parse({
        source: "api",
        provider: "unknown",
        modelId: "model",
        modelName: "Model",
      }),
    ).toThrow();
    expect(() =>
      setAiProviderKeyInputSchema.parse({ provider: "openrouter", key: "secret", extra: true }),
    ).toThrow();
  });
});
