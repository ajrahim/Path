import { expect, it } from "vitest";
import {
  updateGuideInputSchema,
  MAX_GUIDE_CONTEXT_IMAGE_BYTES,
  saveDocumentWorkflowPlanInputSchema,
  generateGuideCollectionInputSchema,
} from "../src";

const request = {
  id: "00000000-0000-4000-8000-000000000001",
  instructions: "",
  currentMarkdown: "",
  updatePrompt: "Update",
};

it("validates editable workflow boundaries while permitting an intentionally empty plan", () => {
  const workflow = {
    id: "00000000-0000-4000-8000-000000000002",
    title: "Login",
    scope: "Login screen",
  };

  const input = { id: request.id, expectedPlanVersion: 0, workflows: [] };

  expect(saveDocumentWorkflowPlanInputSchema.safeParse(input).success).toBe(true);
  expect(
    generateGuideCollectionInputSchema.safeParse({
      id: request.id,
      instructions: "Spec",
      mode: "split",
    }).success,
  ).toBe(true);
  expect(
    generateGuideCollectionInputSchema.safeParse({
      id: request.id,
      instructions: "",
      mode: "split",
      workflows: [],
    }).success,
  ).toBe(false);
  for (const workflows of [
    [{ ...workflow, title: " " }],
    [{ ...workflow, title: "x".repeat(121) }],
    [workflow, { ...workflow, id: "00000000-0000-4000-8000-000000000003", title: "login" }],
    [workflow, { ...workflow, title: "Profile" }],
    Array.from({ length: 25 }, (_, index) => ({
      ...workflow,
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      title: `Workflow ${index}`,
    })),
  ]) {
    expect(saveDocumentWorkflowPlanInputSchema.safeParse({ ...input, workflows }).success).toBe(
      false,
    );
  }

  expect(
    saveDocumentWorkflowPlanInputSchema.safeParse({
      ...input,
      workflows: [{ ...workflow, title: "x".repeat(120) }],
    }).success,
  ).toBe(true);
});

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
