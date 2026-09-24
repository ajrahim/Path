import { expect, it } from "vitest";
import { updateGuideInputSchema, MAX_GUIDE_CONTEXT_IMAGE_BYTES } from "../src";

const request = {
  id: "00000000-0000-4000-8000-000000000001",
  instructions: "",
  currentMarkdown: "",
  updatePrompt: "Update",
};

it("accepts bounded text and PNG context and remains compatible without attachments", () => {
  expect(updateGuideInputSchema.safeParse(request).success).toBe(true);
  expect(
    updateGuideInputSchema.safeParse({
      ...request,
      context: [
        { kind: "text", text: "Reference" },
        { kind: "image", name: "screen.png", dataUrl: "data:image/png;base64,YQ==" },
      ],
    }).success,
  ).toBe(true);
});
it("rejects too many attachments, oversized text or images, and non-PNG payloads", () => {
  for (const context of [
    Array.from({ length: 5 }, () => ({ kind: "text", text: "Reference" })),
    [{ kind: "text", text: "x".repeat(20_001) }],
    [
      {
        kind: "image",
        name: "x.png",
        dataUrl: "data:image/png;base64," + "A".repeat(MAX_GUIDE_CONTEXT_IMAGE_BYTES * 2),
      },
    ],
    [{ kind: "image", name: "x.svg", dataUrl: "data:image/svg+xml;base64,YQ==" }],
  ]) {
    expect(updateGuideInputSchema.safeParse({ ...request, context }).success).toBe(false);
  }
});
