// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUILT_IN_FLOWS, FLOW_STORAGE_KEY, loadInstructionFlows } from "@path/shared";
import { useInstructionFlows } from "../src/hooks/useInstructionFlows";
import { createInstructionFlowFixture } from "./InstructionFlowFixture";

const mocks = vi.hoisted(() => ({ desktop: null as unknown, translate: (key: string) => key }));

vi.mock("../src/lib/Desktop", () => ({ getDesktopApi: () => mocks.desktop }));
vi.mock("next-intl", () => ({ useTranslations: () => mocks.translate }));
let fixture: ReturnType<typeof createInstructionFlowFixture>;

beforeEach(() => {
  window.localStorage.clear();
  fixture = createInstructionFlowFixture();
  mocks.desktop = { instructionFlows: fixture.api };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
async function setup(options?: Parameters<typeof useInstructionFlows>[0]) {
  const view = renderHook(() => useInstructionFlows(options));

  await waitFor(() => expect(view.result.current.loaded).toBe(true));

  return view;
}

describe("instruction flow workflow", () => {
  it("migrates legacy prompts and retains their recovery source", async () => {
    const legacy = JSON.stringify({
      selectedId: "custom-1",
      customFlows: [{ id: "custom-1", name: "My prompt", instructions: "Keep my format" }],
    });

    window.localStorage.setItem(FLOW_STORAGE_KEY, legacy);
    const view = await setup();

    await waitFor(() => expect(view.result.current.selectedFlow.id).toBe("custom-1"));
    expect(view.result.current.selectedFlow.icon).toBe("file-text");
    expect(window.localStorage.getItem(FLOW_STORAGE_KEY)).toBe(legacy);
  });

  it("waits for legacy migration before enabling prompt actions", async () => {
    const legacy = loadInstructionFlows(
      JSON.stringify({
        selectedId: "custom-legacy",
        customFlows: [{ id: "custom-legacy", name: "Legacy", instructions: "Use this prompt" }],
      }),
    );

    let finishMigration!: (state: typeof legacy) => void;

    window.localStorage.setItem(FLOW_STORAGE_KEY, JSON.stringify(legacy));
    vi.mocked(fixture.api.migrate).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishMigration = resolve;
        }),
    );
    const { result } = renderHook(() => useInstructionFlows());

    await waitFor(() => expect(fixture.api.migrate).toHaveBeenCalledOnce());
    // Even an unrelated snapshot during migration must not enable fallback instructions.
    act(() => fixture.publish(loadInstructionFlows(null)));
    expect(result.current.loaded).toBe(false);
    await act(async () => {
      await result.current.selectFlow("spec-document");
    });
    expect(fixture.api.select).not.toHaveBeenCalled();
    await act(async () => finishMigration({ ...legacy, revision: 1 }));
    expect(result.current.loaded).toBe(true);
    expect(result.current.selectedFlow.instructions).toBe("Use this prompt");
  });

  it("edits default instructions and icon in place, but cannot delete or rename a default", async () => {
    const { result } = await setup();
    const original = { ...BUILT_IN_FLOWS[0] };

    act(() => result.current.editSelectedFlow());
    act(() => {
      result.current.renameDraft("Not a new name");
      result.current.reviseInstructions("My help instructions");
      result.current.changeIcon("lightbulb");
    });
    expect(result.current.editor?.name).toBe("Help Guide");
    await act(async () => {
      await result.current.deleteFlow();
    });
    expect(fixture.api.remove).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.saveFlow();
    });
    expect(result.current.selectedFlow).toMatchObject({
      id: "help-guide",
      instructions: "My help instructions",
      icon: "lightbulb",
    });
    expect(result.current.customFlows).toEqual([]);
    expect(BUILT_IN_FLOWS[0]).toEqual(original);
    expect(fixture.api.save).toHaveBeenCalledWith(
      expect.objectContaining({
        expected: {
          name: original.name,
          instructions: original.instructions,
          icon: original.icon,
        },
      }),
    );
  });

  it("creates, edits, and deletes custom prompts without changing the settings selection", async () => {
    const { result } = await setup({ selectOnCreate: false });

    await act(async () => {
      await result.current.selectFlow("create");
    });
    act(() => {
      result.current.renameDraft("QA");
      result.current.reviseInstructions("Review quality");
      result.current.changeIcon("bug");
    });
    await act(async () => {
      await result.current.saveFlow();
    });
    const created = result.current.customFlows[0];

    expect(created.icon).toBe("bug");
    expect(result.current.selectedFlow.id).toBe("help-guide");
    act(() => result.current.editFlow(created.id));
    act(() => result.current.renameDraft("QA review"));
    await act(async () => {
      await result.current.saveFlow();
    });
    expect(result.current.customFlows[0].name).toBe("QA review");
    act(() => result.current.editFlow(created.id));
    await act(async () => {
      await result.current.deleteFlow();
    });
    expect(result.current.customFlows).toEqual([]);
    expect(result.current.selectedFlow.id).toBe("help-guide");
  });

  it("selects a newly created workspace prompt", async () => {
    const { result } = await setup();

    await act(async () => {
      await result.current.selectFlow("create");
    });
    act(() => {
      result.current.renameDraft("Review");
      result.current.reviseInstructions("Review this");
    });
    await act(async () => {
      await result.current.saveFlow();
    });
    expect(result.current.selectedFlow.name).toBe("Review");
  });

  it("retains drafts and saved state on duplicate names or failed writes", async () => {
    const { result } = await setup();

    await act(async () => {
      await result.current.selectFlow("create");
    });
    act(() => {
      result.current.renameDraft("help guide");
      result.current.reviseInstructions("Draft");
    });
    await act(async () => {
      await result.current.saveFlow();
    });
    expect(result.current.editor?.error).toBe("guide.flowDuplicate");
    act(() => result.current.renameDraft("My prompt"));
    vi.mocked(fixture.api.save).mockRejectedValueOnce(new Error("Disk is full"));
    await act(async () => {
      await result.current.saveFlow();
    });
    expect(result.current.editor).toMatchObject({
      name: "My prompt",
      instructions: "Draft",
      error: "Disk is full",
    });
    expect(result.current.customFlows).toEqual([]);
  });

  it("synchronizes saved changes between hook instances while preserving unsaved drafts", async () => {
    const first = await setup();
    const second = await setup();

    act(() => second.result.current.editSelectedFlow());
    act(() => second.result.current.reviseInstructions("Uncommitted second window draft"));
    act(() => first.result.current.editSelectedFlow());
    act(() => first.result.current.reviseInstructions("Saved in first window"));
    await act(async () => {
      await first.result.current.saveFlow();
    });
    expect(second.result.current.selectedFlow.instructions).toBe("Saved in first window");
    expect(second.result.current.editor?.instructions).toBe("Uncommitted second window draft");
    act(() => fixture.publish(loadInstructionFlows(null)));
    expect(second.result.current.selectedFlow.instructions).toBe("Saved in first window");
  });

  it("retains a stale draft and its original snapshot when another window changes the prompt", async () => {
    const { result } = await setup();
    const original = { ...result.current.selectedFlow };

    act(() => result.current.editSelectedFlow());
    act(() => result.current.reviseInstructions("My unsaved draft"));
    act(() =>
      fixture.publish({
        ...loadInstructionFlows(null),
        revision: 1,
        builtInOverrides: [{ id: original.id, instructions: "Newer saved prompt", icon: "bug" }],
      }),
    );
    vi.mocked(fixture.api.save).mockRejectedValueOnce(
      new Error("This prompt changed in another window."),
    );
    await act(async () => {
      await result.current.saveFlow();
    });
    expect(fixture.api.save).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: "My unsaved draft",
        expected: {
          name: original.name,
          instructions: original.instructions,
          icon: original.icon,
        },
      }),
    );
    expect(result.current.selectedFlow.instructions).toBe("Newer saved prompt");
    expect(result.current.editor).toMatchObject({
      instructions: "My unsaved draft",
      error: "This prompt changed in another window.",
    });
  });

  it("keeps authoritative prompts usable when legacy migration fails", async () => {
    fixture = createInstructionFlowFixture({
      ...loadInstructionFlows(null),
      revision: 4,
      builtInOverrides: [{ id: "help-guide", instructions: "Saved override", icon: "code" }],
    });
    mocks.desktop = { instructionFlows: fixture.api };
    window.localStorage.setItem(
      FLOW_STORAGE_KEY,
      JSON.stringify({ selectedId: "help-guide", customFlows: [] }),
    );
    vi.mocked(fixture.api.migrate).mockRejectedValueOnce(new Error("Migration failed"));
    const { result } = await setup();

    await waitFor(() => expect(result.current.error).toBe("Migration failed"));
    expect(result.current.selectedFlow.instructions).toBe("Saved override");
  });

  it("does not enable actions when the initial desktop read fails", async () => {
    vi.mocked(fixture.api.get).mockRejectedValueOnce(new Error("Cannot read prompts"));
    const { result } = renderHook(() => useInstructionFlows());

    await waitFor(() => expect(result.current.error).toBe("Cannot read prompts"));
    expect(result.current.loaded).toBe(false);
    await act(async () => {
      await result.current.selectFlow("spec-document");
    });
    expect(fixture.api.select).not.toHaveBeenCalled();
  });
});
