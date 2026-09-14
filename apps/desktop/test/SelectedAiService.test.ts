import { afterEach, describe, expect, it, vi } from "vitest";
import { PNG } from "pngjs";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SelectedAiService } from "../src/ai/SelectedAiService";

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
      setModel: vi.fn(),
      generateText: vi.fn().mockResolvedValue("# Guide"),
      analyze: vi.fn(),
      listModels: vi.fn(),
    };

    const service = new SelectedAiService(
      {
        get: () => ({
          aiModelSelection: { source: "local", modelId: "gemma4:latest", modelName: "Gemma" },
        }),
      } as never,
      {} as never,
      ollama as never,
    );

    await expect(service.generateText("Write a guide")).resolves.toBe("# Guide");
    expect(ollama.setModel).toHaveBeenCalledWith("gemma4:latest");
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
        get: () => ({
          aiModelSelection: {
            source: "api",
            provider: "openai",
            modelId: "gpt-4o",
            modelName: "gpt-4o",
          },
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
        get: () => ({
          aiModelSelection: {
            source: "api",
            provider: "google",
            modelId: "gemini-2.5-flash",
            modelName: "Gemini 2.5 Flash",
          },
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
        get: () => ({
          aiModelSelection: {
            source: "api",
            provider: "openai",
            modelId: "gpt-4o",
            modelName: "GPT-4o",
          },
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
        get: () => ({
          aiModelSelection: {
            source: "api",
            provider: "openai",
            modelId: "gpt-4o",
            modelName: "GPT-4o",
          },
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
        get: () => ({
          aiModelSelection: {
            source: "api",
            provider: "google",
            modelId: "gemini-3.7-flash",
            modelName: "Gemini 3.7 Flash",
          },
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
        get: () => ({
          aiModelSelection: {
            source: "api",
            provider: "openai",
            modelId: "gpt-4o",
            modelName: "GPT-4o",
          },
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
        get: () => ({
          aiModelSelection: {
            source: "api",
            provider: "google",
            modelId: "gemini-3.7-flash",
            modelName: "Gemini 3.7 Flash",
          },
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
        get: () => ({
          aiModelSelection: {
            source: "api",
            provider: "google",
            modelId: "gemini-3.7-flash",
            modelName: "Gemini 3.7 Flash",
          },
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

  it("does not retry non-transient API errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "Invalid key" } }), { status: 401 }),
      );

    vi.stubGlobal("fetch", fetchMock);
    const service = new SelectedAiService(
      {
        get: () => ({
          aiModelSelection: {
            source: "api",
            provider: "openai",
            modelId: "gpt-4o",
            modelName: "GPT-4o",
          },
        }),
      } as never,
      { get: vi.fn().mockResolvedValue("secret") } as never,
      {} as never,
    );

    await expect(service.generateText("Fail once")).rejects.toThrow("Invalid key");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
