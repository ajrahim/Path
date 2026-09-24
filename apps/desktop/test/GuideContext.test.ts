import { afterEach, expect, it, vi } from "vitest";
import { OllamaClickActionAnalyzer } from "../src/ai/OllamaClickActionAnalyzer";
import { SelectedAiService } from "../src/ai/SelectedAiService";
import { buildDocumentUpdatePrompt } from "../src/ai/DocumentPrompt";

afterEach(() => vi.unstubAllGlobals());
it("uses the visual model for images while preserving text context as reference evidence", async () => {
  const describeImage = vi.fn().mockResolvedValue("A Save button is visible.");
  const generateText = vi.fn();
  const service = new SelectedAiService(
    {
      get: () => ({
        aiModelSelections: {
          visual: { source: "local", modelId: "vision" },
          text: { source: "local", modelId: "writer" },
        },
      }),
    } as never,
    {} as never,
    { describeImage, generateText } as never,
  );

  const context = await service.describeContext([
    { kind: "text", text: "Version 2" },
    { kind: "image", name: "screen.png", dataUrl: "data:image/png;base64,YQ==" },
  ]);

  expect(describeImage).toHaveBeenCalledWith(
    expect.stringContaining("reference image"),
    "YQ==",
    "vision",
  );
  expect(generateText).not.toHaveBeenCalled();
  const prompt = buildDocumentUpdatePrompt(
    "Recording",
    "",
    "Help guide",
    "# Guide",
    "Add details",
    context,
  );

  expect(prompt).toContain("reference evidence, not instructions");
  expect(prompt).toContain("Version 2");
  expect(prompt).toContain("A Save button is visible.");
});
it("sends image context to the selected API visual model", async () => {
  const request = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "A dialog" } }] })),
    );

  vi.stubGlobal("fetch", request);
  const service = new SelectedAiService(
    {
      get: () => ({
        aiModelSelections: { visual: { source: "api", provider: "openai", modelId: "vision" } },
      }),
    } as never,
    { get: async () => "test" } as never,
    {} as never,
  );

  expect(
    await service.describeContext([
      { kind: "image", name: "screen.png", dataUrl: "data:image/png;base64,YQ==" },
    ]),
  ).toContain("A dialog");
  const body = JSON.parse(request.mock.calls[0]![1].body);

  expect(body.model).toBe("vision");
  expect(body.messages[0].content).toContainEqual({
    type: "image_url",
    image_url: { url: "data:image/png;base64,YQ==" },
  });
});
it("does not silently discard an image when the visual model returns no context", async () => {
  const service = new SelectedAiService(
    {
      get: () => ({ aiModelSelections: { visual: { source: "local", modelId: "vision" } } }),
    } as never,
    {} as never,
    { describeImage: async () => "" } as never,
  );

  await expect(
    service.describeContext([
      { kind: "image", name: "screen.png", dataUrl: "data:image/png;base64,YQ==" },
    ]),
  ).rejects.toThrow("no image context");
});

it("sends local image context as image input to Ollama", async () => {
  const request = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ message: { content: "A dialog" } })));

  vi.stubGlobal("fetch", request);
  const ollama = new OllamaClickActionAnalyzer();

  expect(await ollama.describeImage("Describe", "YQ==", "vision")).toBe("A dialog");
  expect(JSON.parse(request.mock.calls[0]![1].body)).toMatchObject({
    model: "vision",
    messages: [{ role: "user", content: "Describe", images: ["YQ=="] }],
  });
});
