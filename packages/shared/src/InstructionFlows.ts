import { z } from "zod";

export const instructionFlowIcons = [
  "book-open",
  "file-code",
  "message-square",
  "file-text",
  "list-checks",
  "bug",
  "lightbulb",
  "clipboard",
  "code",
  "sparkles",
] as const;

export type InstructionFlowIcon = (typeof instructionFlowIcons)[number];

export interface InstructionFlow {
  id: string;
  name: string;
  instructions: string;
  icon: InstructionFlowIcon;
}

export interface InstructionFlowState {
  selectedId: string;
  customFlows: InstructionFlow[];
  builtInOverrides: { id: string; instructions: string; icon: InstructionFlowIcon }[];
  revision: number;
}

export const BUILT_IN_FLOWS: InstructionFlow[] = [
  {
    id: "help-guide",
    name: "Help Guide",
    icon: "book-open",
    instructions:
      "Create a concise software help guide in Markdown for an end user. Include a clear title, purpose, supported prerequisites, numbered steps with the observed control names and expected results, and troubleshooting only when supported by the recording. Follow the recorded workflow and use plain, direct language. Do not invent missing steps.",
  },
  {
    id: "spec-document",
    name: "Spec Document",
    icon: "file-code",
    instructions:
      "Create an improvement specification in Markdown for spec-driven development. Treat the recording as a walkthrough of an existing product or workflow to improve, not a new feature specification or an end-user tutorial. Focus on targeted changes to existing behavior rather than designing a new product or unrelated capabilities. Include: Title and Improvement Summary; Current Behavior and Recorded Evidence; Observed Problems and Requested Improvements; Goals, Scope, and Non-goals; Proposed Changes with stable REQ identifiers, each describing current behavior, desired behavior, and rationale; Acceptance Criteria linked to each change using Given/When/Then; Existing Behavior to Preserve and Regression Checks; Affected UI States, Data, and Interface Contracts only where supported; Risks, Compatibility, and Edge Cases; Open Questions. Ground each problem and change in recorded actions or narration, citing video timestamps when available. Distinguish observed facts, explicitly requested improvements, and assumptions. Do not treat every recorded interaction as a defect or as a requirement to rebuild it. Preserve working behavior and existing contracts unless a supported improvement requires changing them. Do not invent problems, new features, architecture, APIs, performance targets, or business rules. Mark unsupported details as unknown or open questions. If the intended improvement is unclear, document the current workflow and ask focused open questions instead of inventing a solution. Make acceptance criteria test the improvement and guard against regressions. Keep implementation choices separate from the specification.",
  },
  {
    id: "provide-feedback",
    name: "Provide Feedback",
    icon: "message-square",
    instructions:
      "Create an actionable app feedback document in Markdown from this video review. Include a clear title and summary, the reviewed app or workflow when identifiable, and individual findings with stable IDs. For each finding include the observed behavior, supporting narration or video timestamps when available, user impact, reproduction steps that were actually shown, expected behavior only when stated or supported, and a specific suggested improvement. Distinguish bugs, usability feedback, and feature suggestions. Separate observed facts from the reviewer's opinions and your recommendations. Include positive feedback when supported, then priorities with evidence-based rationale and open questions. Do not treat every click as a defect, invent issues, infer unseen behavior, invent timestamps or screenshots, or claim that a suggested fix has been tested. Mark missing context and uncertain expectations explicitly. Keep the document concise, constructive, and ready to share with an app team.",
  },
];

const instructionFlowIdSchema = z.string().trim().min(1).max(200);
const instructionFlowNameSchema = z.string().trim().min(1).max(80);
const instructionFlowInstructionsSchema = z.string().trim().min(1).max(10_000);
const instructionFlowIconSchema = z.enum(instructionFlowIcons);
const customInstructionFlowSchema = z.strictObject({
  id: instructionFlowIdSchema.refine((id) => id.startsWith("custom-")),
  name: instructionFlowNameSchema,
  instructions: instructionFlowInstructionsSchema,
  icon: instructionFlowIconSchema,
});

export const instructionFlowIdInputSchema = z.strictObject({ id: instructionFlowIdSchema });

export const saveInstructionFlowInputSchema = z
  .strictObject({
    id: instructionFlowIdSchema.optional(),
    name: instructionFlowNameSchema,
    instructions: instructionFlowInstructionsSchema,
    icon: instructionFlowIconSchema,
    select: z.boolean().optional(),
    expected: z
      .strictObject({
        name: instructionFlowNameSchema,
        instructions: instructionFlowInstructionsSchema,
        icon: instructionFlowIconSchema,
      })
      .optional(),
  })
  .superRefine((input, context) => {
    if (input.id && !input.expected) {
      context.addIssue({
        code: "custom",
        path: ["expected"],
        message: "An original prompt is required when editing an existing prompt.",
      });
    }
  });

export type SaveInstructionFlowInput = z.infer<typeof saveInstructionFlowInputSchema>;

const builtInOverrideSchema = z.strictObject({
  id: instructionFlowIdSchema.refine((id) => BUILT_IN_FLOWS.some((flow) => flow.id === id)),
  instructions: instructionFlowInstructionsSchema,
  icon: instructionFlowIconSchema,
});

/** Reads a stored prompt library, dropping malformed entries instead of trusting them. */
export function parseInstructionFlowState(parsed: unknown): InstructionFlowState {
  const state: InstructionFlowState = {
    selectedId: "help-guide",
    customFlows: [],
    builtInOverrides: [],
    revision: 0,
  };

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return state;

  if ("customFlows" in parsed && Array.isArray(parsed.customFlows)) {
    const ids = new Set<string>();

    for (const candidate of parsed.customFlows) {
      const result = customInstructionFlowSchema.safeParse(candidate);

      if (!result.success || ids.has(result.data.id)) continue;

      ids.add(result.data.id);
      state.customFlows.push(result.data);
    }
  }

  if ("builtInOverrides" in parsed && Array.isArray(parsed.builtInOverrides)) {
    const ids = new Set<string>();

    for (const candidate of parsed.builtInOverrides) {
      const result = builtInOverrideSchema.safeParse(candidate);

      if (!result.success || ids.has(result.data.id)) continue;

      ids.add(result.data.id);
      state.builtInOverrides.push(result.data);
    }
  }

  if (
    "selectedId" in parsed &&
    resolveInstructionFlows(state).some((flow) => flow.id === parsed.selectedId)
  ) {
    state.selectedId = parsed.selectedId as string;
  }

  if (
    "revision" in parsed &&
    typeof parsed.revision === "number" &&
    Number.isSafeInteger(parsed.revision) &&
    parsed.revision >= 0
  ) {
    state.revision = parsed.revision;
  }

  return state;
}

/** Built-in identities stay fixed while saved text and icons replace their defaults. */
export function resolveInstructionFlows(state: InstructionFlowState): InstructionFlow[] {
  return [
    ...BUILT_IN_FLOWS.map((flow) => {
      const override = state.builtInOverrides.find((candidate) => candidate.id === flow.id);

      return override
        ? { ...flow, instructions: override.instructions, icon: override.icon }
        : { ...flow };
    }),
    ...state.customFlows.map((flow) => ({ ...flow })),
  ];
}
