import { describe, expect, it } from "vitest";
import {
  buildDocumentActivity,
  buildDocumentPrompt,
  normalizeDocumentMarkdown,
} from "../src/ai/DocumentPrompt";

describe("document generation prompt", () => {
  it("defaults to a help guide for existing callers", () => {
    expect(buildDocumentPrompt("Recording", "Clicked Save", " ")).toContain(
      "help guide with a clear title and numbered steps",
    );
  });

  it("uses the selected flow without forcing help-guide formatting", () => {
    const prompt = buildDocumentPrompt(
      "Recording",
      "Clicked Save",
      "Create a spec document with acceptance criteria.",
    );

    expect(prompt).toContain("spec document with acceptance criteria");
    expect(prompt).not.toContain("numbered steps");
    expect(prompt).toContain("Clearly label assumptions and open questions");
    expect(prompt).toContain("Clicked Save");
  });

  it("supports custom instructions and missing activity", () => {
    const prompt = buildDocumentPrompt("Recording", "", "Write a QA checklist.");

    expect(prompt).toContain("Document instructions: Write a QA checklist.");
    expect(prompt).toContain("No activity was captured.");
  });
});

describe("document activity", () => {
  it("combines evidence chronologically and identifies undescribed clicks", () => {
    expect(
      buildDocumentActivity(
        [{ startMs: 2_000, text: "Save the document" }],
        [{ timestampMs: 1_000, actionDescription: null, button: "left" }],
      ),
    ).toBe("[1.0s] Click: left click\n[2.0s] Speech: Save the document");
  });

  it("limits evidence after ordering it", () => {
    // Reverse the input so truncating before sorting would discard the earliest evidence.
    const transcript = Array.from({ length: 301 }, (_, index) => ({
      startMs: (300 - index) * 1_000,
      text: `Item ${300 - index}`,
    }));

    const lines = buildDocumentActivity(transcript, []).split("\n");

    expect(lines).toHaveLength(300);
    expect(lines[0]).toBe("[0.0s] Speech: Item 0");
    expect(lines.at(-1)).toBe("[299.0s] Speech: Item 299");
  });
});

describe("document Markdown normalization", () => {
  it("unwraps a complete Markdown response fence", () => {
    expect(normalizeDocumentMarkdown(" \n```markdown\n# Guide\n```\n ")).toBe("# Guide");
  });

  it("preserves a document ending in a code example", () => {
    const markdown = "# Guide\n\n```sh\nnpm test\n```";

    expect(normalizeDocumentMarkdown(markdown)).toBe(markdown);
  });

  it("preserves code-only responses with an explicit language", () => {
    const markdown = "```ts\nconst ready = true;\n```";

    expect(normalizeDocumentMarkdown(markdown)).toBe(markdown);
  });

  it("preserves separate fenced blocks with document text between them", () => {
    const markdown = "```\nFirst example\n```\n\nExplanation\n\n```sh\nnpm test\n```";

    expect(normalizeDocumentMarkdown(markdown)).toBe(markdown);
  });

  it("preserves ambiguous nested fences rather than corrupting document content", () => {
    const markdown = "```markdown\n# Guide\n\n```ts\nconst ready = true;\n```\n```";

    expect(normalizeDocumentMarkdown(markdown)).toBe(markdown);
  });

  it("normalizes an empty fenced response so callers can reject missing output", () => {
    expect(normalizeDocumentMarkdown("```markdown\n```")).toBe("");
    expect(normalizeDocumentMarkdown("```\r\n\r\n```")).toBe("");
  });
});
