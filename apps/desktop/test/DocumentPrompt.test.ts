import { describe, expect, it } from "vitest";
import {
  buildDocumentActivity,
  buildDocumentPrompt,
  buildDocumentUpdatePrompt,
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

describe("document update prompt", () => {
  it("frames the request as an update to the original intent with full context", () => {
    const prompt = buildDocumentUpdatePrompt(
      "Recording",
      "[1.0s] Click: left click",
      "Create a spec document with acceptance criteria.",
      "# Current guide",
      "Add a troubleshooting section.",
    );

    expect(prompt).toContain("change to the original document intent");
    expect(prompt).toContain(
      "Original document instructions: Create a spec document with acceptance criteria.",
    );
    expect(prompt).toContain("[1.0s] Click: left click");
    expect(prompt).toContain("# Current guide");
    expect(prompt).toContain("Add a troubleshooting section.");
    expect(prompt).toContain("complete updated Markdown document only");
  });

  it("covers missing activity and an empty current document", () => {
    const prompt = buildDocumentUpdatePrompt("Recording", "", " ", "", "Summarize the steps.");

    expect(prompt).toContain("No activity was captured.");
    expect(prompt).toContain("No document exists yet.");
    expect(prompt).toContain("Summarize the steps.");
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

  it("interleaves imported logs and element paths as labeled, single-line evidence", () => {
    const activity = buildDocumentActivity(
      [{ startMs: 2_000, text: "Open the menu" }],
      [],
      [
        { kind: "element", timestampMs: 2_500, text: "Header > #nav > .menu > #first" },
        { kind: "log", timestampMs: 1_000, text: "Error: failed\n    at save (form.ts:10)" },
      ],
    );

    expect(activity).toBe(
      [
        "[1.0s] Log: Error: failed at save (form.ts:10)",
        "[2.0s] Speech: Open the menu",
        "[2.5s] UI element: Header > #nav > .menu > #first",
      ].join("\n"),
    );
  });

  it("bounds imported rows separately and samples them across the recording", () => {
    const transcript = Array.from({ length: 300 }, (_, index) => ({
      startMs: index * 1_000,
      text: `Speech ${index}`,
    }));

    const importedEntries = Array.from({ length: 1_000 }, (_, index) => ({
      kind: "log" as const,
      timestampMs: index * 300,
      text: `Row ${index} ${"x".repeat(400)}`,
    }));

    const lines = buildDocumentActivity(transcript, [], importedEntries).split("\n");
    const logLines = lines.filter((line) => line.includes("] Log: "));

    expect(lines.filter((line) => line.includes("] Speech: "))).toHaveLength(300);
    expect(logLines).toHaveLength(200);
    expect(logLines[0]).toContain("Log: Row 0 ");
    expect(logLines.at(-1)).toContain("Log: Row 995 ");
    expect(logLines.every((line) => line.endsWith("…"))).toBe(true);
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
