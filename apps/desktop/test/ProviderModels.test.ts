import { afterEach, describe, expect, it, vi } from "vitest";
import { listProviderModels } from "../src/ai/ProviderModels";

afterEach(() => {
  vi.useRealTimers();
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

    await expect(listProviderModels("anthropic", "secret-key")).resolves.toMatchObject([
      { id: "claude-model-a", name: "Claude Model A", supportedPurposes: ["text"] },
      { id: "claude-model-b", name: "Claude Model B", supportedPurposes: ["text"] },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/models?limit=1000",
      expect.objectContaining({ headers: expect.objectContaining({ "x-api-key": "secret-key" }) }),
    );
  });

  it("lists OpenAI text and vision models without advertising unsupported model transports", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              { id: "text-embedding-3-small" },
              { id: "gpt-3.5-turbo" },
              { id: "gpt-4o" },
              { id: "gpt-5" },
              { id: "o4-mini" },
              { id: "gpt-image-1" },
              { id: "gpt-4o-audio-preview" },
              { id: "gpt-4o-realtime-preview" },
              { id: "gpt-4o-mini-transcribe" },
              { id: "gpt-5-pro" },
              { id: "gpt-5-codex" },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(listProviderModels("openai", "secret-key")).resolves.toMatchObject([
      { id: "gpt-3.5-turbo", supportedPurposes: ["text"] },
      { id: "gpt-4o", supportedPurposes: ["visual", "text"] },
      { id: "gpt-5", supportedPurposes: ["visual", "text"] },
    ]);
  });

  it("uses OpenRouter input and output modalities for purpose filtering and keeps pricing", async () => {
    vi.resetModules();
    const { listOpenRouterCatalog } = await import("../src/ai/ProviderModels");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: "router/text-only",
              name: "Text Only",
              context_length: 64000,
              architecture: {
                modality: "text->text",
                input_modalities: ["text"],
                output_modalities: ["text"],
              },
              pricing: { prompt: "0.0000005", completion: "0.0000015" },
            },
            {
              id: "router/vision-pro",
              name: "Vision Pro",
              context_length: 128000,
              architecture: {
                modality: "text+image->text",
                input_modalities: ["text", "image"],
                output_modalities: ["text"],
              },
              pricing: { prompt: "0.0000015", completion: "0.000006" },
            },
            {
              id: "router/vision-free:free",
              name: "Vision Free",
              architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
              pricing: { prompt: "0", completion: "0" },
            },
            {
              id: "router/image-output",
              architecture: { input_modalities: ["text", "image"], output_modalities: ["image"] },
            },
            {
              id: "router/missing-capabilities",
              architecture: { modality: ["text", "image"] },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(listOpenRouterCatalog()).resolves.toEqual([
      {
        id: "router/text-only",
        name: "Text Only",
        provider: "openrouter",
        vendor: "router",
        supportedPurposes: ["text"],
        contextLength: 64000,
        pricing: { promptPerMillion: 0.5, completionPerMillion: 1.5 },
        isFree: false,
      },
      {
        id: "router/vision-free:free",
        name: "Vision Free",
        provider: "openrouter",
        vendor: "router",
        supportedPurposes: ["visual", "text"],
        contextLength: null,
        pricing: { promptPerMillion: 0, completionPerMillion: 0 },
        isFree: true,
      },
      {
        id: "router/vision-pro",
        name: "Vision Pro",
        provider: "openrouter",
        vendor: "router",
        supportedPurposes: ["visual", "text"],
        contextLength: 128000,
        pricing: { promptPerMillion: 1.5, completionPerMillion: 6 },
        isFree: false,
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/models",
      expect.objectContaining({ headers: {} }),
    );
  });

  it("reuses the OpenRouter catalog until its cache expires", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-21T00:00:00.000Z"));

    const { listOpenRouterCatalog } = await import("../src/ai/ProviderModels");
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));

    vi.stubGlobal("fetch", fetchMock);

    await listOpenRouterCatalog();
    await listOpenRouterCatalog();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(300_000);
    await listOpenRouterCatalog();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects an invalid OpenRouter key without listing models", async () => {
    vi.resetModules();
    const { listProviderModels: listFreshProviderModels } =
      await import("../src/ai/ProviderModels");

    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "Invalid key" } }), { status: 401 }),
      );

    vi.stubGlobal("fetch", fetchMock);

    await expect(listFreshProviderModels("openrouter", "bad-key")).rejects.toThrow(
      "openrouter rejected the request: Invalid key",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/auth/key",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer bad-key" }),
      }),
    );
  });

  it("keeps Google text generation models and excludes specialized output models", async () => {
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
              {
                name: "models/gemini-2.5-flash-preview-tts",
                supportedGenerationMethods: ["generateContent"],
              },
              {
                name: "models/gemini-2.5-flash-image",
                supportedGenerationMethods: ["generateContent"],
              },
              { name: "models/gemma-2-27b-it", supportedGenerationMethods: ["generateContent"] },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(listProviderModels("google", "secret-key")).resolves.toMatchObject([
      { id: "gemini-test", name: "Gemini Test", supportedPurposes: ["visual", "text"] },
      { id: "gemma-2-27b-it", supportedPurposes: ["text"] },
    ]);
  });

  it("recognizes both Anthropic vision naming conventions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [{ id: "claude-3-7-sonnet-latest" }, { id: "claude-sonnet-4-6" }],
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(listProviderModels("anthropic", "secret-key")).resolves.toMatchObject([
      { id: "claude-3-7-sonnet-latest", supportedPurposes: ["visual", "text"] },
      { id: "claude-sonnet-4-6", supportedPurposes: ["visual", "text"] },
    ]);
  });
});
