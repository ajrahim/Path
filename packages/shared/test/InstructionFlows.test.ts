import { describe, expect, it } from "vitest";
import {
  BUILT_IN_FLOWS,
  loadInstructionFlows,
  migrateInstructionFlowsInputSchema,
  resolveInstructionFlows,
  saveInstructionFlowInputSchema,
} from "../src/InstructionFlows";

const custom = { id: "custom-one", name: "My prompt", instructions: "Describe the workflow." };

describe("instruction flow contracts", () => {
  it("retains stable default IDs, names, and instructions while adding icons", () => {
    expect(BUILT_IN_FLOWS.map((flow) => [flow.id, flow.icon])).toEqual([
      ["help-guide", "book-open"],
      ["spec-document", "file-code"],
      ["provide-feedback", "message-square"],
    ]);
    expect(BUILT_IN_FLOWS[1].instructions).toContain("Given/When/Then");
  });

  it("loads old prompts with a default icon and an initial revision", () => {
    expect(
      loadInstructionFlows(JSON.stringify({ selectedId: custom.id, customFlows: [custom] })),
    ).toEqual({
      selectedId: custom.id,
      customFlows: [{ ...custom, icon: "file-text" }],
      builtInOverrides: [],
      revision: 0,
    });
  });

  it("rejects malformed entries, duplicate IDs, and unknown overrides while retaining valid entries", () => {
    const state = loadInstructionFlows(
      JSON.stringify({
        selectedId: "missing",
        customFlows: [custom, custom, { ...custom, id: "custom-two", icon: "unknown" }],
        builtInOverrides: [
          { id: "help-guide", instructions: "Updated", icon: "bug" },
          { id: "unknown", instructions: "Bad", icon: "bug" },
        ],
        revision: -3,
      }),
    );

    expect(state.customFlows).toEqual([{ ...custom, icon: "file-text" }]);
    expect(state.selectedId).toBe("help-guide");
    expect(state.revision).toBe(0);
    expect(resolveInstructionFlows(state)[0]).toMatchObject({
      name: "Help Guide",
      instructions: "Updated",
      icon: "bug",
    });
    expect(state.builtInOverrides).toHaveLength(1);
  });

  it.each([null, "bad", "[]", "42"])("safely defaults invalid stored data: %s", (stored) => {
    expect(loadInstructionFlows(stored)).toEqual({
      selectedId: "help-guide",
      customFlows: [],
      builtInOverrides: [],
      revision: 0,
    });
  });

  it("bounds input text, validates icon IDs, and forbids extra renderer fields", () => {
    const draft = { name: "My prompt", instructions: "Content", icon: "sparkles" };

    expect(saveInstructionFlowInputSchema.safeParse(draft).success).toBe(true);
    for (const input of [
      { ...draft, name: " " },
      { ...draft, name: "x".repeat(81) },
      { ...draft, instructions: "x".repeat(10_001) },
      { ...draft, icon: "unknown" },
      { ...draft, builtIn: false },
    ]) {
      expect(saveInstructionFlowInputSchema.safeParse(input).success).toBe(false);
    }

    expect(
      migrateInstructionFlowsInputSchema.safeParse({ selectedId: custom.id, customFlows: [custom] })
        .success,
    ).toBe(true);
    expect(
      migrateInstructionFlowsInputSchema.safeParse({
        selectedId: custom.id,
        customFlows: [{ ...custom, id: "help-guide" }],
      }).success,
    ).toBe(false);
  });

  it("requires the original prompt fields when an existing prompt is edited", () => {
    const draft = { name: "My prompt", instructions: "Updated", icon: "bug" };

    expect(saveInstructionFlowInputSchema.safeParse(draft).success).toBe(true);
    expect(
      saveInstructionFlowInputSchema.safeParse({ ...draft, id: "custom-existing" }).success,
    ).toBe(false);
    expect(
      saveInstructionFlowInputSchema.safeParse({
        ...draft,
        id: "custom-existing",
        expected: { ...draft, instructions: "Original" },
      }).success,
    ).toBe(true);
    expect(
      saveInstructionFlowInputSchema.safeParse({
        ...draft,
        id: "custom-existing",
        expected: { ...draft, id: "custom-existing" },
      }).success,
    ).toBe(false);
  });
});
