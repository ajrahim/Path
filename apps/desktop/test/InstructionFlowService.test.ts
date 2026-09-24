import { describe, expect, it, vi } from "vitest";
import {
  BUILT_IN_FLOWS,
  resolveInstructionFlows,
  type InstructionFlow,
  type InstructionFlowState,
} from "@path/shared";
import { InstructionFlowService } from "../src/settings/InstructionFlowService";

const legacyFlow = {
  id: "custom-legacy",
  name: "Release notes",
  instructions: "Describe changes.",
};

const draft = {
  name: "My prompt",
  instructions: "Document what happened.",
  icon: "sparkles" as const,
};

async function createLibrary() {
  const values = new Map<string, unknown>();
  const repository = {
    get: vi.fn(
      async <T>(key: string): Promise<T | null> =>
        structuredClone(values.get(key) ?? null) as T | null,
    ),
    set: vi.fn(async (key: string, value: unknown) => {
      values.set(key, structuredClone(value));
    }),
  };

  const changed = vi.fn<(state: InstructionFlowState) => void>();
  const library = new InstructionFlowService(repository, changed);

  await library.initialize();

  return { library, repository, changed };
}

function expectedPrompt({ name, instructions, icon }: InstructionFlow) {
  return { name, instructions, icon };
}

describe("InstructionFlowService", () => {
  it("migrates legacy prompts with icons once and preserves them after restart", async () => {
    const { library, repository, changed } = await createLibrary();
    const state = await library.migrate({ selectedId: legacyFlow.id, customFlows: [legacyFlow] });

    expect(state).toMatchObject({
      selectedId: legacyFlow.id,
      revision: 1,
      customFlows: [{ ...legacyFlow, icon: "file-text" }],
    });
    await library.migrate({ selectedId: legacyFlow.id, customFlows: [legacyFlow] });
    expect(changed).toHaveBeenCalledTimes(1);
    const restored = new InstructionFlowService(repository);

    await restored.initialize();
    expect(restored.get()).toEqual(state);
  });

  it("allows a later window to migrate after an empty first window", async () => {
    const { library, repository } = await createLibrary();

    await library.migrate({ selectedId: "help-guide", customFlows: [] });
    expect(repository.set).not.toHaveBeenCalled();
    const state = await library.migrate({ selectedId: legacyFlow.id, customFlows: [legacyFlow] });

    expect(state.selectedId).toBe(legacyFlow.id);
  });

  it("keeps edited defaults and the current selection when legacy data arrives later", async () => {
    const { library } = await createLibrary();

    await library.save({
      ...BUILT_IN_FLOWS[0],
      instructions: "Custom default text.",
      icon: "bug",
      expected: expectedPrompt(BUILT_IN_FLOWS[0]),
    });
    await library.select({ id: "spec-document" });
    const state = await library.migrate({ selectedId: legacyFlow.id, customFlows: [legacyFlow] });

    expect(state.selectedId).toBe("spec-document");
    expect(resolveInstructionFlows(state)[0]).toMatchObject({
      instructions: "Custom default text.",
      icon: "bug",
    });
  });

  it("never overwrites an imported prompt or resurrects one after deletion and restart", async () => {
    const { library, repository } = await createLibrary();

    await library.migrate({ selectedId: legacyFlow.id, customFlows: [legacyFlow] });
    await library.save({
      ...legacyFlow,
      instructions: "Edited content.",
      icon: "bug",
      expected: expectedPrompt({ ...legacyFlow, icon: "file-text" }),
    });
    await library.migrate({ selectedId: legacyFlow.id, customFlows: [legacyFlow] });
    expect(library.get().customFlows[0].instructions).toBe("Edited content.");
    await library.remove({ id: legacyFlow.id });
    const restored = new InstructionFlowService(repository);

    await restored.initialize();
    await restored.migrate({ selectedId: legacyFlow.id, customFlows: [legacyFlow] });
    expect(restored.get().customFlows).toEqual([]);
  });

  it("preserves conflicting imported names under a unique name", async () => {
    const { library } = await createLibrary();

    await library.save({ ...draft, name: legacyFlow.name });
    const state = await library.migrate({ selectedId: legacyFlow.id, customFlows: [legacyFlow] });

    expect(state.customFlows.map((flow) => flow.name)).toEqual([
      legacyFlow.name,
      "Release notes (2)",
    ]);
  });

  it("allows editing default text and icons but rejects renaming and deletion", async () => {
    const { library } = await createLibrary();
    const builtin = BUILT_IN_FLOWS[0];
    const state = await library.save({
      ...builtin,
      instructions: "Updated prompt.",
      icon: "clipboard",
      expected: expectedPrompt(builtin),
    });

    expect(resolveInstructionFlows(state)[0]).toEqual({
      ...builtin,
      instructions: "Updated prompt.",
      icon: "clipboard",
    });
    await expect(
      library.save({
        ...builtin,
        name: "Renamed",
        expected: expectedPrompt(resolveInstructionFlows(state)[0]),
      }),
    ).rejects.toThrow("cannot be renamed");
    await expect(library.remove({ id: builtin.id })).rejects.toThrow("cannot be deleted");
    expect(BUILT_IN_FLOWS[0]).toEqual(builtin);
  });

  it("creates and renames custom prompts, preserves selection unless requested, and falls back after removal", async () => {
    const { library } = await createLibrary();
    const created = await library.save(draft);
    const flow = created.customFlows[0];

    expect(created.selectedId).toBe("help-guide");
    expect(flow.id).toMatch(/^custom-/);
    const selected = await library.save({
      ...flow,
      name: "Renamed",
      select: true,
      expected: expectedPrompt(flow),
    });

    expect(selected.selectedId).toBe(flow.id);
    expect(selected.customFlows[0].name).toBe("Renamed");
    const removed = await library.remove({ id: flow.id });

    expect(removed.selectedId).toBe("help-guide");
    expect(removed.customFlows).toEqual([]);
  });

  it("rejects duplicate names and stale editing or selection targets", async () => {
    const { library } = await createLibrary();

    await expect(library.save({ ...draft, name: "help guide" })).rejects.toThrow("already exists");
    await expect(library.save({ ...draft, id: "custom-missing", expected: draft })).rejects.toThrow(
      "no longer available",
    );
    await expect(library.select({ id: "custom-missing" })).rejects.toThrow("no longer available");
  });

  it("does not publish or replace current state when persistence fails, and permits retry", async () => {
    const { library, repository, changed } = await createLibrary();

    repository.set.mockRejectedValueOnce(new Error("Disk unavailable"));
    await expect(library.save(draft)).rejects.toThrow("Disk unavailable");
    expect(library.get().revision).toBe(0);
    expect(library.get().customFlows).toEqual([]);
    expect(changed).not.toHaveBeenCalled();
    const state = await library.save(draft);

    expect(state.revision).toBe(1);
    expect(changed).toHaveBeenCalledOnce();
  });

  it("leaves failed migration retryable and imports the legacy data on retry", async () => {
    const { library, repository } = await createLibrary();

    repository.set.mockRejectedValueOnce(new Error("Disk unavailable"));
    await expect(
      library.migrate({ selectedId: legacyFlow.id, customFlows: [legacyFlow] }),
    ).rejects.toThrow("Disk unavailable");
    const state = await library.migrate({ selectedId: legacyFlow.id, customFlows: [legacyFlow] });

    expect(state.customFlows).toHaveLength(1);
  });

  it("serializes edits and selection against the latest committed state", async () => {
    const { library, repository, changed } = await createLibrary();
    let release!: () => void;

    repository.set.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const editing = library.save({
      ...BUILT_IN_FLOWS[0],
      instructions: "Saved in another window.",
      expected: expectedPrompt(BUILT_IN_FLOWS[0]),
    });

    const selecting = library.select({ id: "spec-document" });

    await Promise.resolve();
    expect(library.get().revision).toBe(0);
    expect(changed).not.toHaveBeenCalled();
    release();
    await editing;
    const state = await selecting;

    expect(state.selectedId).toBe("spec-document");
    expect(resolveInstructionFlows(state)[0].instructions).toBe("Saved in another window.");
    expect(state.revision).toBe(2);
    expect(changed.mock.calls.map(([snapshot]) => snapshot.revision)).toEqual([1, 2]);
  });

  it("isolates pending mutation inputs, results, and notifications from external mutations", async () => {
    const { library, changed } = await createLibrary();
    const input = { ...draft };
    const saving = library.save(input);

    input.instructions = "Mutated after submission";
    const result = await saving;

    result.customFlows[0].instructions = "Mutated snapshot";
    changed.mock.calls[0][0].customFlows[0].instructions = "Mutated event";
    expect(library.get().customFlows[0].instructions).toBe(draft.instructions);
  });

  it.each(["name", "instructions", "icon"] as const)(
    "rejects a stale custom editor after another window changes its %s without committing",
    async (field) => {
      const { library, repository, changed } = await createLibrary();
      const created = await library.save(draft);
      const original = created.customFlows[0];
      const replacement = {
        name: "Renamed elsewhere",
        instructions: "Edited elsewhere",
        icon: "bug" as const,
      };

      const firstSave = library.save({
        ...original,
        [field]: replacement[field],
        expected: expectedPrompt(original),
      });

      const secondSave = library.save({
        ...original,
        instructions: "Stale editor content",
        expected: expectedPrompt(original),
      });

      const committed = await firstSave;

      await expect(secondSave).rejects.toThrow(
        "This prompt changed in another window. Close and reopen it before saving.",
      );
      expect(library.get()).toEqual(committed);
      expect(repository.set).toHaveBeenCalledTimes(2);
      expect(changed).toHaveBeenCalledTimes(2);
    },
  );

  it("protects default prompt overrides from stale edits", async () => {
    const { library } = await createLibrary();
    const original = BUILT_IN_FLOWS[0];

    await library.save({
      ...original,
      instructions: "Saved elsewhere",
      expected: expectedPrompt(original),
    });
    await expect(
      library.save({ ...original, icon: "bug", expected: expectedPrompt(original) }),
    ).rejects.toThrow("changed in another window");
    expect(resolveInstructionFlows(library.get())[0].instructions).toBe("Saved elsewhere");
  });

  it("allows saving the original editor after selection and unrelated prompt changes", async () => {
    const { library } = await createLibrary();
    const original = BUILT_IN_FLOWS[0];

    await library.select({ id: "spec-document" });
    await library.save(draft);
    const saved = await library.save({
      ...original,
      instructions: "Updated guide",
      expected: expectedPrompt(original),
    });

    expect(saved.selectedId).toBe("spec-document");
    expect(saved.customFlows).toHaveLength(1);
    expect(resolveInstructionFlows(saved)[0].instructions).toBe("Updated guide");
  });
});
