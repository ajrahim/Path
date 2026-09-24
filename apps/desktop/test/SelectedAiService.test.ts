import { afterEach, describe, expect, it, vi } from "vitest";
import { PNG } from "pngjs";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AiModelSelection, AiModelSelections } from "@path/shared";
import { SelectedAiService } from "../src/ai/SelectedAiService";

function settingsWithModel(selection: AiModelSelection): { aiModelSelections: AiModelSelections } {
  return { aiModelSelections: { visual: selection, text: selection } };
}

function png(): Buffer {
  const image = new PNG({ width: 4, height: 4 });

  image.data.fill(255);

  return PNG.sync.write(image);
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("SelectedAiService", () => {
  it("uses the selected local model for text generation", async () => {
    const ollama = {
      generateText: vi.fn().mockResolvedValue("# Guide"),
      analyze: vi.fn(),
      listModels: vi.fn(),
    };

    const service = new SelectedAiService(
      {
        get: () =>
          settingsWithModel({ source: "local", modelId: "gemma4:latest", modelName: "Gemma" }),
      } as never,
      {} as never,
      ollama as never,
    );

    await expect(service.generateText("Write a guide")).resolves.toBe("# Guide");
    expect(ollama.generateText).toHaveBeenCalledWith("Write a guide", "gemma4:latest", undefined);
  });

  it("uses independent local visual and API text selections", async () => {
    const ollama = {
      analyze: vi.fn().mockResolvedValue("The user clicks the Import button."),
      generateText: vi.fn(),
    };

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "# API Guide" } }] }), {
        status: 200,
      }),
    );

    vi.stubGlobal("fetch", fetchMock);
    const service = new SelectedAiService(
      {
        get: () => ({
          aiModelSelections: {
            visual: { source: "local", modelId: "vision-model", modelName: "Vision" },
            text: {
              source: "api",
              provider: "openai",
              modelId: "gpt-3.5-turbo",
              modelName: "Text",
            },
          },
        }),
      } as never,
      { get: vi.fn().mockResolvedValue("secret") } as never,
      ollama as never,
    );

    const input = {
      screenshotPath: "owned-by-analyzer.png",
      timestampMs: 1_000,
      button: "left" as const,
      normalizedX: 0.5,
      normalizedY: 0.5,
    };

    await expect(service.analyze(input)).resolves.toBe("The user clicks the Import button.");
    await expect(service.generateText("Write a guide")).resolves.toBe("# API Guide");

    expect(ollama.analyze).toHaveBeenCalledWith(input, "vision-model");
    expect(ollama.generateText).not.toHaveBeenCalled();
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;

    expect(JSON.parse(String(request.body))).toMatchObject({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: "Write a guide" }],
    });
  });

  it("preserves the legacy local vision list while the catalog includes text models", async () => {
    const text = { id: "text", name: "Text", supportedPurposes: ["text"] };
    const visual = { id: "visual", name: "Visual", supportedPurposes: ["visual", "text"] };
    const service = new SelectedAiService(
      {} as never,
      {} as never,
      { listModels: vi.fn().mockResolvedValue([text, visual]) } as never,
    );

    await expect(service.listLocalModels()).resolves.toEqual([visual]);
  });

  it("uses the selected API model for image analysis", async () => {
    const screenshotPath = join(tmpdir(), "path-selected-ai-test.png");

    await writeFile(screenshotPath, png());
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: "The user clicks the Import button to choose a source file." },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);
    const service = new SelectedAiService(
      {
        get: () =>
          settingsWithModel({
            source: "api",
            provider: "openai",
            modelId: "gpt-4o",
            modelName: "gpt-4o",
          }),
      } as never,
      { get: vi.fn().mockResolvedValue("secret") } as never,
      {} as never,
    );

    await expect(
      service.analyze({
        screenshotPath,
        timestampMs: 1_000,
        button: "left",
        normalizedX: 0.5,
        normalizedY: 0.5,
      }),
    ).resolves.toBe("The user clicks the Import button to choose a source file.");
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    const body = JSON.parse(String(request.body));

    expect(body.model).toBe("gpt-4o");
    expect(body.messages[0].content[1].image_url.url).toMatch(/^data:image\/png;base64,/);
    vi.unstubAllGlobals();
    await rm(screenshotPath, { force: true });
  });

  it("asks Gemini what the user clicked for a help document", async () => {
    const screenshotPath = join(tmpdir(), "path-gemini-click-test.png");

    await writeFile(screenshotPath, png());
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: "**The user right-clicks the Import button to open its context menu.**",
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);
    const service = new SelectedAiService(
      {
        get: () =>
          settingsWithModel({
            source: "api",
            provider: "google",
            modelId: "gemini-2.5-flash",
            modelName: "Gemini 2.5 Flash",
          }),
      } as never,
      { get: vi.fn().mockResolvedValue("secret") } as never,
      {} as never,
    );

    await expect(
      service.analyze({
        screenshotPath,
        timestampMs: 2_500,
        button: "right",
        normalizedX: 0.25,
        normalizedY: 0.75,
        previousSteps: [{ button: "left", description: "Open export menu" }],
        transcriptContext: ["Choose the format for this guide."],
      }),
    ).resolves.toBe("The user right-clicks the Import button to open its context menu.");

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toContain("/models/gemini-2.5-flash:generateContent?key=secret");
    const body = JSON.parse(String(request.body));
    const parts = body.contents[0].parts;

    expect(parts[0].inline_data).toMatchObject({ mime_type: "image/png" });
    expect(parts[0].inline_data.data).toEqual(expect.any(String));
    expect(parts[1].text).toContain("step-by-step help guide");
    expect(parts[1].text).toContain("pressed the right mouse button");
    expect(parts[1].text).toContain("immediate intent");
    expect(parts[1].text).toContain("exactly one concise sentence");
    expect(parts[1].text).toContain("mouse action, the specific target, and the immediate result");
    expect(parts[1].text).toContain("1. Left click: Open export menu");
    expect(parts[1].text).toContain(
      "Recent narration before this click:\n- Choose the format for this guide.",
    );
    expect(parts[1].text).toContain("25% from the left and 75% from the top");
    expect(body.generationConfig.maxOutputTokens).toBeGreaterThanOrEqual(64);
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });

    vi.unstubAllGlobals();
    await rm(screenshotPath, { force: true });
  });

  it("uses the selected API model for text generation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "# API Guide" } }] }), {
        status: 200,
      }),
    );

    vi.stubGlobal("fetch", fetchMock);
    const service = new SelectedAiService(
      {
        get: () =>
          settingsWithModel({
            source: "api",
            provider: "openai",
            modelId: "gpt-4o",
            modelName: "GPT-4o",
          }),
      } as never,
      { get: vi.fn().mockResolvedValue("secret") } as never,
      {} as never,
    );

    await expect(service.generateText("Write a guide")).resolves.toBe("# API Guide");
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));

    expect(body.model).toBe("gpt-4o");
    expect(body.messages[0].content).toBe("Write a guide");
    vi.unstubAllGlobals();
  });

  it("serializes and spaces remote API requests", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T00:00:00.000Z"));
    const requestTimes: number[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        requestTimes.push(Date.now());

        return new Response(JSON.stringify({ choices: [{ message: { content: "Done" } }] }), {
          status: 200,
        });
      }),
    );
    const service = new SelectedAiService(
      {
        get: () =>
          settingsWithModel({
            source: "api",
            provider: "openai",
            modelId: "gpt-4o",
            modelName: "GPT-4o",
          }),
      } as never,
      { get: vi.fn().mockResolvedValue("secret") } as never,
      {} as never,
    );

    const first = service.generateText("First");
    const second = service.generateText("Second");

    await vi.advanceTimersByTimeAsync(0);
    expect(requestTimes).toHaveLength(1);
    await expect(first).resolves.toBe("Done");

    // Check both sides of the spacing boundary without waiting on wall-clock time.
    await vi.advanceTimersByTimeAsync(749);
    expect(requestTimes).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(second).resolves.toBe("Done");
    expect(requestTimes[1]! - requestTimes[0]!).toBe(750);
  });

  it("paces Gemini requests for the five-request free tier", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T00:00:00.000Z"));
    const requestTimes: number[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        requestTimes.push(Date.now());

        return new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: "Done" }] } }] }),
          { status: 200 },
        );
      }),
    );
    const service = new SelectedAiService(
      {
        get: () =>
          settingsWithModel({
            source: "api",
            provider: "google",
            modelId: "gemini-3.7-flash",
            modelName: "Gemini 3.7 Flash",
          }),
      } as never,
      { get: vi.fn().mockResolvedValue("secret") } as never,
      {} as never,
    );

    const first = service.generateText("First");
    const second = service.generateText("Second");

    await vi.advanceTimersByTimeAsync(0);
    await expect(first).resolves.toBe("Done");

    await vi.advanceTimersByTimeAsync(12_999);
    expect(requestTimes).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(second).resolves.toBe("Done");
    expect(requestTimes[1]! - requestTimes[0]!).toBe(13_000);
  });

  it("honors Retry-After when the API throttles a request", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "Rate limited" } }), {
          status: 429,
          headers: { "retry-after": "2" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: "Done" } }] }), {
          status: 200,
        }),
      );

    vi.stubGlobal("fetch", fetchMock);
    const service = new SelectedAiService(
      {
        get: () =>
          settingsWithModel({
            source: "api",
            provider: "openai",
            modelId: "gpt-4o",
            modelName: "GPT-4o",
          }),
      } as never,
      { get: vi.fn().mockResolvedValue("secret") } as never,
      {} as never,
    );

    const request = service.generateText("Retry me");

    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(request).resolves.toBe("Done");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("honors Gemini retry timing embedded in an error message", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { message: "Quota exceeded. Please retry in 46.407179813s." } }),
          { status: 429 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Done" }] } }] }), {
          status: 200,
        }),
      );

    vi.stubGlobal("fetch", fetchMock);
    const service = new SelectedAiService(
      {
        get: () =>
          settingsWithModel({
            source: "api",
            provider: "google",
            modelId: "gemini-3.7-flash",
            modelName: "Gemini 3.7 Flash",
          }),
      } as never,
      { get: vi.fn().mockResolvedValue("secret") } as never,
      {} as never,
    );

    const request = service.generateText("Retry me");

    // Fractional seconds must round up so the retry cannot precede the provider's deadline.
    await vi.advanceTimersByTimeAsync(46_407);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(request).resolves.toBe("Done");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops after one delayed retry when Gemini remains rate limited", async () => {
    vi.useFakeTimers();
    const response = () =>
      new Response(
        JSON.stringify({ error: { message: "Quota exceeded. Please retry in 46.407179813s." } }),
        { status: 429 },
      );

    const fetchMock = vi.fn().mockImplementation(async () => response());

    vi.stubGlobal("fetch", fetchMock);
    const service = new SelectedAiService(
      {
        get: () =>
          settingsWithModel({
            source: "api",
            provider: "google",
            modelId: "gemini-3.7-flash",
            modelName: "Gemini 3.7 Flash",
          }),
      } as never,
      { get: vi.fn().mockResolvedValue("secret") } as never,
      {} as never,
    );

    const request = service.generateText("Retry once");

    // Attach the rejection handler before advancing the timer that rejects the request.
    const rejection = expect(request).rejects.toMatchObject({
      name: "AiRateLimitError",
      retryAfterMs: 46_408,
    });

    await vi.advanceTimersByTimeAsync(46_408);
    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses the selected OpenRouter model for text generation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "# Router Guide" } }] }), {
        status: 200,
      }),
    );

    vi.stubGlobal("fetch", fetchMock);
    const service = new SelectedAiService(
      {
        get: () =>
          settingsWithModel({
            source: "api",
            provider: "openrouter",
            modelId: "router/vision-pro",
            modelName: "Vision Pro",
          }),
      } as never,
      { get: vi.fn().mockResolvedValue("secret") } as never,
      {} as never,
    );

    await expect(service.generateText("Write a guide")).resolves.toBe("# Router Guide");
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body));

    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(body.model).toBe("router/vision-pro");
    expect(body.messages[0].content).toBe("Write a guide");
    vi.unstubAllGlobals();
  });

  it("lists the OpenRouter catalog without a key and reports Ollama as running", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              {
                id: "router/vision-pro",
                name: "Vision Pro",
                context_length: 128000,
                architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
                pricing: { prompt: "0.0000015", completion: "0.000006" },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const service = new SelectedAiService(
      {} as never,
      {
        getStatus: vi
          .fn()
          .mockResolvedValue({ anthropic: false, openai: false, google: false, openrouter: false }),
        get: vi.fn(),
      } as never,
      {
        listModels: vi.fn().mockResolvedValue([]),
        getEndpoint: () => "http://127.0.0.1:11434",
      } as never,
    );

    await expect(service.listModels()).resolves.toEqual({
      api: [
        {
          id: "router/vision-pro",
          name: "Vision Pro",
          provider: "openrouter",
          vendor: "router",
          supportedPurposes: ["visual", "text"],
          supportsEffort: false,
          contextLength: 128000,
          pricing: { promptPerMillion: 1.5, completionPerMillion: 6 },
          isFree: false,
        },
      ],
      local: [],
      ollama: { status: "running", endpoint: "http://127.0.0.1:11434" },
    });
    vi.unstubAllGlobals();
  });

  it("reports Ollama as unavailable when local discovery fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
        }),
      ),
    );
    const service = new SelectedAiService(
      {} as never,
      {
        getStatus: vi
          .fn()
          .mockResolvedValue({ anthropic: false, openai: false, google: false, openrouter: false }),
        get: vi.fn(),
      } as never,
      {
        listModels: vi.fn().mockRejectedValue(new Error("daemon down")),
        getEndpoint: () => "http://127.0.0.1:11434",
      } as never,
    );

    const catalog = await service.listModels();

    expect(catalog.local).toEqual([]);
    expect(catalog.ollama).toEqual({ status: "unavailable", endpoint: "http://127.0.0.1:11434" });
    vi.unstubAllGlobals();
  });

  it("sends reasoning effort without temperature for OpenAI reasoning models", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "# Guide" } }] }), {
        status: 200,
      }),
    );

    vi.stubGlobal("fetch", fetchMock);
    const service = new SelectedAiService(
      {
        get: () =>
          settingsWithModel({
            source: "api",
            provider: "openai",
            modelId: "gpt-5",
            modelName: "GPT-5",
            effort: "high",
          }),
      } as never,
      { get: vi.fn().mockResolvedValue("secret") } as never,
      {} as never,
    );

    await expect(service.generateText("Write a guide")).resolves.toBe("# Guide");
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));

    expect(body.reasoning_effort).toBe("high");
    expect(body).not.toHaveProperty("temperature");
    vi.unstubAllGlobals();
  });

  it("ignores effort for standard models and keeps deterministic temperature", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "# Guide" } }] }), {
        status: 200,
      }),
    );

    vi.stubGlobal("fetch", fetchMock);
    const service = new SelectedAiService(
      {
        get: () =>
          settingsWithModel({
            source: "api",
            provider: "openai",
            modelId: "gpt-4o",
            modelName: "GPT-4o",
            effort: "high",
          }),
      } as never,
      { get: vi.fn().mockResolvedValue("secret") } as never,
      {} as never,
    );

    await expect(service.generateText("Write a guide")).resolves.toBe("# Guide");
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));

    expect(body.temperature).toBe(0);
    expect(body).not.toHaveProperty("reasoning_effort");
    vi.unstubAllGlobals();
  });

  it("maps effort to Gemini thinking budgets and levels", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "# Guide" }] } }] }),
        { status: 200 },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);
    const settings = {
      get: () =>
        settingsWithModel({
          source: "api",
          provider: "google",
          modelId: "gemini-2.5-flash",
          modelName: "Gemini 2.5 Flash",
          effort: "high",
        }),
    } as never;
    const service = new SelectedAiService(
      settings,
      { get: vi.fn().mockResolvedValue("secret") } as never,
      {} as never,
    );

    await expect(service.generateText("Write a guide")).resolves.toBe("# Guide");

    const flashBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));

    expect(flashBody.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 24576 });
    vi.unstubAllGlobals();
  });

  it("passes effort through to the local model for text generation", async () => {
    const ollama = { generateText: vi.fn().mockResolvedValue("# Guide") };
    const service = new SelectedAiService(
      {
        get: () =>
          settingsWithModel({
            source: "local",
            modelId: "qwen3:latest",
            modelName: "Qwen 3",
            effort: "low",
          }),
      } as never,
      {} as never,
      ollama as never,
    );

    await expect(service.generateText("Write a guide")).resolves.toBe("# Guide");
    expect(ollama.generateText).toHaveBeenCalledWith("Write a guide", "qwen3:latest", "low");
  });

  it("does not retry non-transient API errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "Invalid key" } }), { status: 401 }),
      );

    vi.stubGlobal("fetch", fetchMock);
    const service = new SelectedAiService(
      {
        get: () =>
          settingsWithModel({
            source: "api",
            provider: "openai",
            modelId: "gpt-4o",
            modelName: "GPT-4o",
          }),
      } as never,
      { get: vi.fn().mockResolvedValue("secret") } as never,
      {} as never,
    );

    await expect(service.generateText("Fail once")).rejects.toThrow("Invalid key");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
