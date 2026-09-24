import { describe, expect, it } from "vitest";
import { BUILT_IN_FLOWS, loadInstructionFlows } from "@path/shared";

describe("instruction flows", () => {
  it("provides help and spec presets with distinct output requirements", () => {
    expect(BUILT_IN_FLOWS.map((flow) => flow.id)).toEqual([
      "help-guide",
      "spec-document",
      "provide-feedback",
    ]);
    expect(BUILT_IN_FLOWS[0].instructions).toContain("numbered steps");
    expect(BUILT_IN_FLOWS[1].instructions).toContain("Given/When/Then");
    expect(BUILT_IN_FLOWS[1].instructions).toContain("unknown or open questions");
  });

  it("scopes specs to evidence-based improvements of existing behavior", () => {
    const instructions = BUILT_IN_FLOWS[1].instructions;

    expect(instructions).toContain("improvement specification");
    expect(instructions).toContain("not a new feature specification");
    expect(instructions).toContain("current behavior, desired behavior, and rationale");
    expect(instructions).toContain("Existing Behavior to Preserve and Regression Checks");
    expect(instructions).toContain("citing video timestamps when available");
    expect(instructions).toContain("ask focused open questions instead of inventing a solution");
  });

  it("defaults to Help Guide and restores built-in selection", () => {
    expect(loadInstructionFlows(null).selectedId).toBe("help-guide");
    expect(
      loadInstructionFlows(JSON.stringify({ selectedId: "spec-document", customFlows: [] }))
        .selectedId,
    ).toBe("spec-document");
  });

  it("restores feedback with evidence-grounded review instructions", () => {
    const feedback = BUILT_IN_FLOWS.find((flow) => flow.id === "provide-feedback")!;

    expect(feedback.name).toBe("Provide Feedback");
    expect(feedback.instructions).toContain("reproduction steps that were actually shown");
    expect(feedback.instructions).toContain("Separate observed facts");
    expect(
      loadInstructionFlows(JSON.stringify({ selectedId: feedback.id, customFlows: [] })).selectedId,
    ).toBe(feedback.id);
  });

  it("restores named custom flows and the selection", () => {
    const state = {
      selectedId: "custom-qa",
      customFlows: [{ id: "custom-qa", name: "QA Checklist", instructions: "Write test cases." }],
    };

    expect(loadInstructionFlows(JSON.stringify(state))).toMatchObject({
      ...state,
      customFlows: [{ ...state.customFlows[0], icon: "file-text" }],
    });
  });

  it("recovers from malformed storage and invalid selections", () => {
    expect(loadInstructionFlows("{bad").selectedId).toBe("help-guide");
    expect(
      loadInstructionFlows(
        JSON.stringify({
          selectedId: "gone",
          customFlows: [null, {}, { id: "help-guide", name: "Override", instructions: "No" }],
        }),
      ),
    ).toMatchObject({ selectedId: "help-guide", customFlows: [] });
  });
});
