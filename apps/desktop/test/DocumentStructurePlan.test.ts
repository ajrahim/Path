import { describe, expect, it } from "vitest";
import type { DocumentStructurePlan } from "@path/shared";
import {
  buildPlannedDocumentPrompt,
  buildSectionRepairPrompt,
  buildStructurePlanPrompt,
  buildStructurePlanRepairPrompt,
  findMissingSections,
  parseStructurePlan,
} from "../src/ai/DocumentStructurePlan";

const ACTIVITY = "[1.0s] Speech: Sign in\n[3.0s] Speech: Create a new account";
const INSTRUCTIONS = "Create specs with acceptance criteria.";

const PLAN: DocumentStructurePlan = {
  sharedContext: "Acme Portal; the visitor signs in with email.",
  documents: [
    {
      title: "Login",
      scope: "Sign-in at 1s",
      evidence: [{ startSeconds: 0, endSeconds: 2 }],
      sections: [
        { heading: "Current Behavior", coverage: "Sign-in narration at 1.0s" },
        { heading: "Acceptance Criteria", coverage: "Given/When/Then for sign-in" },
      ],
    },
    {
      title: "Registration",
      scope: "Account creation at 3s",
      evidence: [],
      sections: [{ heading: "Open Questions", coverage: "Email confirmation is not shown" }],
    },
  ],
};

describe("structure plan prompt", () => {
  it("asks for content-selected documents and their sections in split mode", () => {
    const prompt = buildStructurePlanPrompt("Recording", ACTIVITY, INSTRUCTIONS, "split");

    expect(prompt).toContain("Plan separate documents for EVERY distinct workflow");
    expect(prompt).toContain("document count yourself");
    expect(prompt).toContain("existing UI tabs are not constraints");
    expect(prompt).toContain("include every section the instructions require");
    expect(prompt).toContain('"sections":[{"heading"');
    expect(prompt).toContain(`Document instructions: ${INSTRUCTIONS}`);
    expect(prompt).toContain(ACTIVITY);
    expect(prompt).not.toContain("Plan exactly one document");
  });

  it("constrains combine mode to one document and tolerates missing input", () => {
    const prompt = buildStructurePlanPrompt("Recording", "", " ", "combine");

    expect(prompt).toContain("Plan exactly one document");
    expect(prompt).not.toContain("EVERY distinct workflow");
    expect(prompt).toContain("help guide with a clear title and numbered steps");
    expect(prompt).toContain("No activity was captured.");
  });

  it("names the rejected problem when asking for a corrected plan", () => {
    const repair = buildStructurePlanRepairPrompt("PLAN PROMPT", "documents.0.sections: Required");

    expect(repair).toContain("PLAN PROMPT");
    expect(repair).toContain("documents.0.sections: Required");
    expect(repair).toContain("corrected JSON object only");
  });
});

describe("structure plan parsing", () => {
  const json = JSON.stringify(PLAN);

  it.each([
    ["a bare object", json],
    ["a fenced object", "```json\n" + json + "\n```"],
    ["an object inside prose", "Here is the plan:\n" + json + "\nLet me know if it helps."],
  ])("accepts %s", (_label, response) => {
    expect(parseStructurePlan(response, "split")).toEqual({ isValid: true, plan: PLAN });
  });

  it.each([
    ["text without an object", "I cannot plan this.", "no JSON object"],
    ["malformed JSON", '{"documents":[', "no JSON object"],
    ["unparseable JSON", '{"documents":[}', "not valid JSON"],
    ["a plan without documents", '{"sharedContext":"","documents":[]}', "documents"],
    [
      "a document without sections",
      JSON.stringify({ ...PLAN, documents: [{ ...PLAN.documents[0], sections: [] }] }),
      "documents.0.sections",
    ],
    [
      "repeated section headings",
      JSON.stringify({
        ...PLAN,
        documents: [
          {
            ...PLAN.documents[0],
            sections: [
              { heading: "Goals", coverage: "One" },
              { heading: "goals", coverage: "Two" },
            ],
          },
        ],
      }),
      "Section headings must be unique",
    ],
    [
      "an evidence range that ends before it starts",
      JSON.stringify({
        ...PLAN,
        documents: [{ ...PLAN.documents[0], evidence: [{ startSeconds: 9, endSeconds: 2 }] }],
      }),
      "must end at or after its start",
    ],
    ["an unexpected field", JSON.stringify({ ...PLAN, notes: "extra" }), "plan"],
  ])("rejects %s with a named problem", (_label, response, problem) => {
    const result = parseStructurePlan(response, "split");

    expect(result.isValid).toBe(false);
    expect(result).toMatchObject({ problem: expect.stringContaining(problem) });
  });

  it("requires exactly one document in combine mode", () => {
    expect(parseStructurePlan(json, "combine")).toEqual({
      isValid: false,
      problem: "documents must contain exactly one document",
    });
    expect(
      parseStructurePlan(JSON.stringify({ ...PLAN, documents: [PLAN.documents[0]] }), "combine")
        .isValid,
    ).toBe(true);
  });
});

describe("planned document prompt", () => {
  it("gives the writer its outline, evidence ranges, shared context, and sibling documents", () => {
    const prompt = buildPlannedDocumentPrompt(
      "Recording",
      ACTIVITY,
      INSTRUCTIONS,
      PLAN,
      PLAN.documents[0]!,
    );

    expect(prompt).toContain(`Document instructions: ${INSTRUCTIONS}`);
    expect(prompt).toContain(ACTIVITY);
    expect(prompt).toContain("planned document only: Login");
    expect(prompt).toContain("Document scope: Sign-in at 1s");
    expect(prompt).toContain("Primary evidence time ranges: 0.0s–2.0s");
    expect(prompt).toContain("Shared context for consistent terminology: Acme Portal");
    expect(prompt).toContain('begin with the line "# Login"');
    expect(prompt).toContain("1. Current Behavior — Sign-in narration at 1.0s");
    expect(prompt).toContain("2. Acceptance Criteria — Given/When/Then for sign-in");
    expect(prompt).toContain("- Registration: Account creation at 3s");
    expect(prompt).not.toContain("- Login: Sign-in at 1s");
    expect(prompt).toContain("do not return an outline or placeholder");
    expect(prompt).toContain(
      "Do not copy these instructions, the section notes, or the sibling list",
    );
  });

  it("omits ranges, shared context, and siblings that the plan does not provide", () => {
    const document = PLAN.documents[1]!;
    const prompt = buildPlannedDocumentPrompt(
      "Recording",
      ACTIVITY,
      INSTRUCTIONS,
      {
        sharedContext: "",
        documents: [document],
      },
      document,
    );

    expect(prompt).not.toContain("Primary evidence time ranges");
    expect(prompt).not.toContain("Shared context");
    expect(prompt).not.toContain("Sibling documents");
    expect(prompt).toContain("1. Open Questions — Email confirmation is not shown");
  });

  it("lists the omitted sections when asking for a rewrite", () => {
    const repair = buildSectionRepairPrompt("DOCUMENT PROMPT", ["Goals", "Open Questions"]);

    expect(repair).toContain("DOCUMENT PROMPT");
    expect(repair).toContain("omitted these required sections: Goals; Open Questions");
  });
});

describe("planned section completeness", () => {
  const document = PLAN.documents[0]!;

  it("accepts planned headings at any level despite numbering, emphasis, and punctuation", () => {
    const markdown = [
      "# Login improvements",
      "## 1. **Current Behavior**",
      "The visitor signs in.",
      "### Acceptance criteria:",
      "- Given a visitor",
    ].join("\n");

    expect(findMissingSections(markdown, document)).toEqual([]);
  });

  it("accepts typographic hyphens and quotes a model substitutes in a planned heading", () => {
    const planned = {
      ...document,
      sections: [
        { heading: "Goals, Scope, and Non-goals", coverage: "Scope" },
        { heading: "2026 Roadmap for 'Sign in'", coverage: "Dates" },
      ],
    };

    // U+2011 non-breaking hyphen and curly quotes, as a local model wrote them.
    const markdown = "## Goals, Scope, and Non‑goals\n## 2. 2026 Roadmap for ‘Sign in’";

    expect(findMissingSections(markdown, planned)).toEqual([]);
    expect(findMissingSections("## Goals and Scope", planned)).toEqual([
      "Goals, Scope, and Non-goals",
      "2026 Roadmap for 'Sign in'",
    ]);
  });

  it("reports planned headings that appear only as body text or not at all", () => {
    const markdown = "# Login\n\n## Current Behavior\nAcceptance Criteria are listed later.";

    expect(findMissingSections(markdown, document)).toEqual(["Acceptance Criteria"]);
    expect(findMissingSections("", document)).toEqual(["Current Behavior", "Acceptance Criteria"]);
  });
});
