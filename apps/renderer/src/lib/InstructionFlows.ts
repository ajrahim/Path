export interface InstructionFlow {
  id: string;
  name: string;
  instructions: string;
}

export interface InstructionFlowState {
  selectedId: string;
  customFlows: InstructionFlow[];
}

export const FLOW_STORAGE_KEY = "path.instructionFlows.v1";

export const BUILT_IN_FLOWS: InstructionFlow[] = [
  {
    id: "help-guide",
    name: "Help Guide",
    instructions:
      "Create a concise software help guide in Markdown for an end user. Include a clear title, purpose, supported prerequisites, numbered steps with the observed control names and expected results, and troubleshooting only when supported by the recording. Follow the recorded workflow and use plain, direct language. Do not invent missing steps.",
  },
  {
    id: "spec-document",
    name: "Spec Document",
    instructions:
      "Create an improvement specification in Markdown for spec-driven development. Treat the recording as a walkthrough of an existing product or workflow to improve, not a new feature specification or an end-user tutorial. Focus on targeted changes to existing behavior rather than designing a new product or unrelated capabilities. Include: Title and Improvement Summary; Current Behavior and Recorded Evidence; Observed Problems and Requested Improvements; Goals, Scope, and Non-goals; Proposed Changes with stable REQ identifiers, each describing current behavior, desired behavior, and rationale; Acceptance Criteria linked to each change using Given/When/Then; Existing Behavior to Preserve and Regression Checks; Affected UI States, Data, and Interface Contracts only where supported; Risks, Compatibility, and Edge Cases; Open Questions. Ground each problem and change in recorded actions or narration, citing video timestamps when available. Distinguish observed facts, explicitly requested improvements, and assumptions. Do not treat every recorded interaction as a defect or as a requirement to rebuild it. Preserve working behavior and existing contracts unless a supported improvement requires changing them. Do not invent problems, new features, architecture, APIs, performance targets, or business rules. Mark unsupported details as unknown or open questions. If the intended improvement is unclear, document the current workflow and ask focused open questions instead of inventing a solution. Make acceptance criteria test the improvement and guard against regressions. Keep implementation choices separate from the specification.",
  },
  {
    id: "provide-feedback",
    name: "Provide Feedback",
    instructions:
      "Create an actionable app feedback document in Markdown from this video review. Include a clear title and summary, the reviewed app or workflow when identifiable, and individual findings with stable IDs. For each finding include the observed behavior, supporting narration or video timestamps when available, user impact, reproduction steps that were actually shown, expected behavior only when stated or supported, and a specific suggested improvement. Distinguish bugs, usability feedback, and feature suggestions. Separate observed facts from the reviewer's opinions and your recommendations. Include positive feedback when supported, then priorities with evidence-based rationale and open questions. Do not treat every click as a defect, invent issues, infer unseen behavior, invent timestamps or screenshots, or claim that a suggested fix has been tested. Mark missing context and uncertain expectations explicitly. Keep the document concise, constructive, and ready to share with an app team.",
  },
];

/** Restores valid saved flows, returning default presets if none are stored. */
export function loadInstructionFlows(stored: string | null): InstructionFlowState {
  if (stored) {
    try {
      const parsed: unknown = JSON.parse(stored);

      if (
        parsed &&
        typeof parsed === "object" &&
        "customFlows" in parsed &&
        Array.isArray(parsed.customFlows)
      ) {
        const customFlows = parsed.customFlows.filter((flow: unknown): flow is InstructionFlow => {
          if (!flow || typeof flow !== "object") return false;

          return (
            "id" in flow &&
            typeof flow.id === "string" &&
            flow.id.startsWith("custom-") &&
            "name" in flow &&
            typeof flow.name === "string" &&
            flow.name.trim().length > 0 &&
            flow.name.length <= 80 &&
            "instructions" in flow &&
            typeof flow.instructions === "string" &&
            flow.instructions.trim().length > 0 &&
            flow.instructions.length <= 10_000
          );
        });

        const selectedId =
          "selectedId" in parsed &&
          typeof parsed.selectedId === "string" &&
          [...BUILT_IN_FLOWS, ...customFlows].some((flow) => flow.id === parsed.selectedId)
            ? parsed.selectedId
            : "help-guide";

        return { selectedId, customFlows };
      }
    } catch {
      // Return default flows when storage is malformed.
    }
  }

  return { selectedId: "help-guide", customFlows: [] };
}
