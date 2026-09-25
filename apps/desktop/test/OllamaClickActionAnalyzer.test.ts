import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PNG } from "pngjs";
import { OllamaClickActionAnalyzer } from "../src/ai/OllamaClickActionAnalyzer";

const temporaryFiles: string[] = [];

function createPng(width = 8, height = 8): Buffer {
  const image = new PNG({ width, height });

  image.data.fill(255);

  return PNG.sync.write(image);
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(temporaryFiles.splice(0).map((path) => rm(path, { force: true })));
});

describe("OllamaClickActionAnalyzer", () => {
  it("discovers text and vision models while excluding models that cannot generate text", async () => {
    const fetchMock = vi.fn(async (input: string, request?: RequestInit) => {
      if (input.endsWith("/api/tags")) {
        return new Response(
          JSON.stringify({
            models: [
              {
                name: "text-model:latest",
                size: 4_100_000_000,
                modified_at: "2026-08-01T00:00:00Z",
              },
              {
                name: "vision-model:latest",
                size: 5_200_000_000,
                modified_at: "2026-09-01T00:00:00Z",
              },
              { name: "embedding-model:latest" },
            ],
          }),
          { status: 200 },
        );
      }

      if (input.endsWith("/api/ps")) {
        return new Response(JSON.stringify({ models: [{ name: "vision-model:latest" }] }), {
          status: 200,
        });
      }

      const body = JSON.parse(String(request?.body));

      return new Response(
        JSON.stringify({
          capabilities: {
            "vision-model:latest": ["completion", "vision"],
            "text-model:latest": ["completion"],
            "embedding-model:latest": ["embedding"],
          }[body.model as string],
        }),
        { status: 200 },
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    const analyzer = new OllamaClickActionAnalyzer();

    await expect(analyzer.listModels()).resolves.toEqual([
      {
        id: "text-model:latest",
        name: "text-model:latest",
        sizeBytes: 4_100_000_000,
        modifiedAt: "2026-08-01T00:00:00Z",
        isLoaded: false,
        supportedPurposes: ["text"],
        supportsEffort: false,
      },
      {
        id: "vision-model:latest",
        name: "vision-model:latest",
        sizeBytes: 5_200_000_000,
        modifiedAt: "2026-09-01T00:00:00Z",
        isLoaded: true,
        supportedPurposes: ["visual", "text"],
        supportsEffort: false,
      },
    ]);
  });

  it("reports no loaded models when the running list is unavailable", async () => {
    const fetchMock = vi.fn(async (input: string, request?: RequestInit) => {
      if (input.endsWith("/api/tags")) {
        return new Response(JSON.stringify({ models: [{ name: "vision-model:latest" }] }), {
          status: 200,
        });
      }

      if (input.endsWith("/api/ps")) {
        return new Response("unavailable", { status: 500 });
      }

      const body = JSON.parse(String(request?.body));

      return new Response(
        JSON.stringify({
          capabilities:
            body.model === "vision-model:latest" ? ["completion", "vision"] : ["completion"],
        }),
        { status: 200 },
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    const analyzer = new OllamaClickActionAnalyzer();

    await expect(analyzer.listModels()).resolves.toEqual([
      {
        id: "vision-model:latest",
        name: "vision-model:latest",
        sizeBytes: null,
        modifiedAt: null,
        isLoaded: false,
        supportedPurposes: ["visual", "text"],
        supportsEffort: false,
      },
    ]);
  });

  it("flags thinking-capable models from daemon capabilities and known families", async () => {
    const fetchMock = vi.fn(async (input: string, request?: RequestInit) => {
      if (input.endsWith("/api/tags")) {
        return new Response(
          JSON.stringify({
            models: [{ name: "qwen3:latest" }, { name: "custom-thinker:latest" }],
          }),
          { status: 200 },
        );
      }

      if (input.endsWith("/api/ps")) {
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      }

      const body = JSON.parse(String(request?.body));

      return new Response(
        JSON.stringify({
          capabilities: {
            "qwen3:latest": ["completion"],
            "custom-thinker:latest": ["completion", "thinking"],
          }[body.model as string],
        }),
        { status: 200 },
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    const analyzer = new OllamaClickActionAnalyzer();

    await expect(analyzer.listModels()).resolves.toMatchObject([
      { id: "custom-thinker:latest", supportsEffort: true },
      { id: "qwen3:latest", supportsEffort: true },
    ]);
  });

  it("sends the selected think level for text generation", async () => {
    // A Response body can be read once, so each generation gets its own reply.
    const fetchMock = vi
      .fn()
      .mockImplementation(
        async () =>
          new Response(JSON.stringify({ message: { content: "# Guide" } }), { status: 200 }),
      );

    vi.stubGlobal("fetch", fetchMock);

    const analyzer = new OllamaClickActionAnalyzer();

    await expect(analyzer.generateText("Write a guide", "qwen3:latest", "high")).resolves.toBe(
      "# Guide",
    );

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));

    expect(body.think).toBe("high");

    await expect(analyzer.generateText("Write a guide", "qwen3:latest")).resolves.toBe("# Guide");

    const defaultBody = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body));

    expect(defaultBody.think).toBe(false);
  });

  it("sends the screenshot, timestamp, and click position to a local model", async () => {
    const screenshotPath = join(tmpdir(), `${randomUUID()}.png`);

    temporaryFiles.push(screenshotPath);
    const screenshot = createPng();

    await writeFile(screenshotPath, screenshot);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: { content: '"The user clicks the Import button to open the file picker."' },
        }),
        { status: 200 },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    const analyzer = new OllamaClickActionAnalyzer("vision-model", "http://127.0.0.1:11434");

    await expect(
      analyzer.analyze({
        screenshotPath,
        timestampMs: 12_340,
        button: "left",
        normalizedX: 0.25,
        normalizedY: 0.75,
        previousSteps: [{ button: "right", description: "Open project menu" }],
        transcriptContext: ["Next, choose the import option."],
      }),
    ).resolves.toBe("The user clicks the Import button to open the file picker.");

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    const body = JSON.parse(String(request.body));

    expect(body.model).toBe("vision-model");
    expect(body.think).toBe(false);
    expect(body.messages[0].content).toContain("12.34 seconds");
    expect(body.messages[0].content).toContain("pressed the left mouse button");
    expect(body.messages[0].content).toContain("25% from the left and 75% from the top");
    expect(body.messages[0].content).toContain("step-by-step help guide");
    expect(body.messages[0].content).toContain("immediate intent");
    expect(body.messages[0].content).toContain("exactly one concise sentence");
    expect(body.messages[0].content).toContain(
      "mouse action, the specific target, and the immediate result",
    );
    expect(body.messages[0].content).toContain("1. Right click: Open project menu");
    expect(body.messages[0].content).toContain(
      "Recent narration before this click:\n- Next, choose the import option.",
    );
    expect(body.messages[0].images).toEqual([screenshot.toString("base64")]);
    expect(body.options.num_predict).toBe(80);
  });

  it("keeps concurrent visual and text requests on their own selected models", async () => {
    const screenshotPath = join(tmpdir(), `${randomUUID()}.png`);

    temporaryFiles.push(screenshotPath);
    await writeFile(screenshotPath, createPng());
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: { content: "Import button" } }), { status: 200 }),
    );

    vi.stubGlobal("fetch", fetchMock);
    const analyzer = new OllamaClickActionAnalyzer("default-model");
    const visual = analyzer.analyze(
      {
        screenshotPath,
        timestampMs: 1_000,
        button: "left",
        normalizedX: 0.5,
        normalizedY: 0.5,
      },
      "vision-model",
    );

    const text = analyzer.generateText("Write a guide", "text-model");

    await Promise.all([visual, text]);
    const requests = fetchMock.mock.calls.map((call) => {
      const request = call[1] as RequestInit;

      return JSON.parse(String(request.body));
    });

    const visualRequest = requests.find((request) => request.messages[0].images);
    const textRequest = requests.find((request) => request.messages[0].content === "Write a guide");

    expect(visualRequest.model).toBe("vision-model");
    expect(textRequest.model).toBe("text-model");
  });

  it("caps the image dimensions around the click target", async () => {
    // A large image and an off-center click exercise cropping near the image boundary.
    const screenshotPath = join(tmpdir(), `${randomUUID()}.png`);

    temporaryFiles.push(screenshotPath);
    await writeFile(screenshotPath, createPng(1_600, 1_200));
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: { content: "Save button" } }), { status: 200 }),
      );

    vi.stubGlobal("fetch", fetchMock);

    await new OllamaClickActionAnalyzer().analyze({
      screenshotPath,
      timestampMs: 1_000,
      button: "right",
      normalizedX: 0.9,
      normalizedY: 0.9,
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));
    const sentImage = PNG.sync.read(Buffer.from(body.messages[0].images[0], "base64"));

    expect({ width: sentImage.width, height: sentImage.height }).toEqual({
      width: 1_280,
      height: 960,
    });
  });

  it.each([
    "I cannot identify the object because no screenshot was provided.",
    "The user clicks a control and then continues describing irrelevant details that make this response far too long for a concise help guide action label and should be rejected",
  ])("replaces an invalid response with Unknown control", async (content) => {
    const screenshotPath = join(tmpdir(), `${randomUUID()}.png`);

    temporaryFiles.push(screenshotPath);
    await writeFile(screenshotPath, createPng());
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ message: { content } }), { status: 200 })),
    );

    await expect(
      new OllamaClickActionAnalyzer().analyze({
        screenshotPath,
        timestampMs: 1_000,
        button: "middle",
        normalizedX: 0.5,
        normalizedY: 0.5,
      }),
    ).resolves.toBe("Unknown control");
  });

  it.each([
    ["left", "Dismiss button", "The user clicks the Dismiss button."],
    ["right", "Selected file", "The user right-clicks the Selected file."],
    ["middle", "Browser tab", "The user middle-clicks the Browser tab."],
  ] as const)(
    "expands a terse %s-click response into a guide sentence",
    async (button, response, expected) => {
      const screenshotPath = join(tmpdir(), `${randomUUID()}.png`);

      temporaryFiles.push(screenshotPath);
      await writeFile(screenshotPath, createPng());
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response(JSON.stringify({ message: { content: response } }), { status: 200 }),
          ),
      );

      await expect(
        new OllamaClickActionAnalyzer().analyze({
          screenshotPath,
          timestampMs: 1_000,
          button,
          normalizedX: 0.5,
          normalizedY: 0.5,
        }),
      ).resolves.toBe(expected);
    },
  );
});
