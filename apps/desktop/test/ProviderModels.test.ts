import { afterEach, describe, expect, it, vi } from "vitest";
import { listProviderModels } from "../src/ai/ProviderModels";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listProviderModels", () => {
  it("loads Anthropic models using the API key header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { id: "claude-model-b", display_name: "Claude Model B" },
            { id: "claude-model-a", display_name: "Claude Model A" },
          ],
        }),
        { status: 200 },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(listProviderModels("anthropic", "secret-key")).resolves.toEqual([
      { id: "claude-model-a", name: "Claude Model A" },
      { id: "claude-model-b", name: "Claude Model B" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/models?limit=1000",
      expect.objectContaining({ headers: expect.objectContaining({ "x-api-key": "secret-key" }) }),
    );
  });

  it("keeps only compatible OpenAI text models", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [{ id: "text-embedding-3-small" }, { id: "gpt-5" }, { id: "o4-mini" }],
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(listProviderModels("openai", "secret-key")).resolves.toEqual([
      { id: "gpt-5", name: "gpt-5" },
      { id: "o4-mini", name: "o4-mini" },
    ]);
  });

  it("keeps Google models that support content generation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            models: [
              {
                name: "models/embedding-001",
                displayName: "Embedding",
                supportedGenerationMethods: ["embedContent"],
              },
              {
                name: "models/gemini-test",
                displayName: "Gemini Test",
                supportedGenerationMethods: ["generateContent"],
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(listProviderModels("google", "secret-key")).resolves.toEqual([
      { id: "gemini-test", name: "Gemini Test" },
    ]);
  });
});
