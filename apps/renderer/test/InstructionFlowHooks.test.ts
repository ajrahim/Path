// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useInstructionFlows } from "../src/hooks/useInstructionFlows";
import { BUILT_IN_FLOWS, FLOW_STORAGE_KEY } from "../src/lib/InstructionFlows";

const mocks = vi.hoisted(() => ({
  translate: (key: string, values?: { name: string }) =>
    key === "guide.customCopy" ? `${values?.name} (Custom)` : key,
}));

vi.mock("next-intl", () => ({ useTranslations: () => mocks.translate }));

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("instruction flow workflow", () => {
  it("restores saved flows and the custom selection after remount", async () => {
    window.localStorage.setItem(
      FLOW_STORAGE_KEY,
      JSON.stringify({
        selectedId: "custom-1",
        customFlows: [{ id: "custom-1", name: "My Prompt", instructions: "Use my format" }],
      }),
    );
    const first = renderHook(() => useInstructionFlows());

    await waitFor(() => expect(first.result.current.loaded).toBe(true));

    expect(first.result.current.selectedFlow.instructions).toBe("Use my format");

    first.unmount();
    const second = renderHook(() => useInstructionFlows());

    expect(second.result.current.selectedFlow.id).toBe("custom-1");
    expect(second.result.current.customFlows).toHaveLength(1);
  });

  it("copies a built-in preset without modifying it, then edits and deletes the copy", () => {
    const { result } = renderHook(() => useInstructionFlows());
    const preset = { ...BUILT_IN_FLOWS[0] };

    act(() => result.current.editSelectedFlow());

    expect(result.current.editor?.mode).toBe("copy");
    expect(result.current.editor?.name).toBe("Help Guide (Custom)");

    act(() => result.current.reviseInstructions("Custom instructions"));
    act(() => result.current.saveFlow());

    expect(result.current.editor).toBeNull();
    expect(result.current.selectedFlow.instructions).toBe("Custom instructions");
    expect(result.current.customFlows).toHaveLength(1);
    expect(BUILT_IN_FLOWS[0]).toEqual(preset);

    act(() => result.current.editSelectedFlow());

    expect(result.current.editor?.mode).toBe("edit");

    act(() => result.current.renameDraft("My revised prompt"));
    act(() => result.current.saveFlow());

    expect(result.current.selectedFlow.name).toBe("My revised prompt");
    expect(result.current.customFlows).toHaveLength(1);

    act(() => result.current.editSelectedFlow());
    act(() => result.current.deleteFlow());

    expect(result.current.selectedFlow.id).toBe("help-guide");
    expect(result.current.customFlows).toHaveLength(0);
  });

  it("retains the editor and saved selection after duplicate-name or storage failures", () => {
    const { result } = renderHook(() => useInstructionFlows());

    act(() => result.current.selectFlow("create"));
    act(() => {
      result.current.renameDraft("help guide");
      result.current.reviseInstructions("Instructions");
    });
    act(() => result.current.saveFlow());

    expect(result.current.editor?.error).toBe("guide.flowDuplicate");

    act(() => result.current.renameDraft("My prompt"));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage is full");
    });
    act(() => result.current.saveFlow());

    expect(result.current.editor?.name).toBe("My prompt");
    expect(result.current.editor?.error).toBe("Storage is full");
    expect(result.current.selectedFlow.id).toBe("help-guide");
    expect(result.current.customFlows).toHaveLength(0);
  });
});
