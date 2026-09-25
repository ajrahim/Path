// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordingTimelineImports, TimelineImport } from "@path/shared";
import { useTimelineImports } from "../src/hooks/useTimelineImports";

const bridge = vi.hoisted(() => ({
  listTimelineImports: vi.fn(),
  importTimelineFile: vi.fn(),
  updateTimelineImportOffset: vi.fn(),
  removeTimelineImport: vi.fn(),
}));

const translate = vi.hoisted(
  () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
);

vi.mock("next-intl", () => ({ useTranslations: () => translate }));
vi.mock("@/lib/Desktop", () => ({ getDesktopApi: () => ({ recordings: bridge }) }));

function logImport(recordingId: string, offsetMs = 0): TimelineImport {
  return {
    kind: "log",
    fileName: `${recordingId}.log`,
    offsetMs,
    importedAt: "2026-09-14T11:00:00.000Z",
    rowCount: 1,
    entryCount: 1,
    outsideCount: 0,
    unreadableLineCount: 0,
  };
}

function listed(recordingId: string): RecordingTimelineImports {
  return {
    window: {
      startedAt: "2026-09-14T10:00:00.000Z",
      endedAt: "2026-09-14T10:00:30.000Z",
    },
    log: logImport(recordingId),
    element: null,
  };
}

const renderImports = (recordingId: string | null = "recording-a") =>
  renderHook((id) => useTimelineImports({ recordingId: id, durationMs: 30_000 }), {
    initialProps: recordingId,
  });

beforeEach(() => {
  vi.resetAllMocks();
  bridge.listTimelineImports.mockImplementation(async ({ id }: { id: string }) => listed(id));
  bridge.removeTimelineImport.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("timeline imports lifecycle", () => {
  it("loads the recording's window and imports", async () => {
    const { result } = renderImports();

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.window?.startedAt).toBe("2026-09-14T10:00:00.000Z");
    expect(result.current.imports.log?.fileName).toBe("recording-a.log");
    expect(result.current.imports.element).toBeNull();
  });

  it("stays idle without a selected recording", () => {
    const { result } = renderImports(null);

    expect(result.current.isLoading).toBe(false);
    expect(bridge.listTimelineImports).not.toHaveBeenCalled();
  });

  it("applies imports and reports typed rejections per kind", async () => {
    const { result } = renderImports();

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const elementImport = { ...logImport("recording-a"), kind: "element" as const };

    bridge.importTimelineFile.mockResolvedValueOnce({
      status: "imported",
      timelineImport: elementImport,
    });
    await act(() => result.current.importFile("element"));

    expect(result.current.imports.element).toEqual(elementImport);
    expect(result.current.errors.element).toBeNull();

    bridge.importTimelineFile.mockResolvedValueOnce({ status: "too-large", maxFileSizeMb: 10 });
    await act(() => result.current.importFile("log"));

    expect(result.current.errors.log).toBe('importTooLarge {"limit":10}');
    expect(result.current.imports.log?.fileName).toBe("recording-a.log");

    bridge.importTimelineFile.mockResolvedValueOnce({ status: "no-rows" });
    await act(() => result.current.importFile("log"));
    expect(result.current.errors.log).toBe("importNoRows");

    bridge.importTimelineFile.mockResolvedValueOnce({ status: "canceled" });
    await act(() => result.current.importFile("log"));
    expect(result.current.errors.log).toBeNull();
  });

  it("updates offsets, skips unchanged offsets, and removes imports", async () => {
    const { result } = renderImports();

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(() => result.current.updateOffset("log", 0));
    expect(bridge.updateTimelineImportOffset).not.toHaveBeenCalled();

    bridge.updateTimelineImportOffset.mockResolvedValueOnce(logImport("recording-a", 2_000));
    await act(() => result.current.updateOffset("log", 2_000));

    expect(bridge.updateTimelineImportOffset).toHaveBeenCalledWith({
      recordingId: "recording-a",
      kind: "log",
      offsetMs: 2_000,
    });
    expect(result.current.imports.log?.offsetMs).toBe(2_000);

    await act(() => result.current.removeImport("log"));

    expect(bridge.removeTimelineImport).toHaveBeenCalledWith({
      recordingId: "recording-a",
      kind: "log",
    });
    expect(result.current.imports.log).toBeNull();
  });

  it("keeps the previous import and shows the error when an operation fails", async () => {
    const { result } = renderImports();

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    bridge.updateTimelineImportOffset.mockRejectedValueOnce(new Error("Offset rejected"));
    await act(() => result.current.updateOffset("log", 5_000));

    expect(result.current.errors.log).toBe("Offset rejected");
    expect(result.current.imports.log?.offsetMs).toBe(0);
    expect(result.current.busyKind).toBeNull();
  });

  it("discards a late import for a recording that is no longer selected", async () => {
    const { result, rerender } = renderImports();

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let finishImport!: (value: unknown) => void;

    bridge.importTimelineFile.mockReturnValueOnce(
      new Promise((resolve) => {
        finishImport = resolve;
      }),
    );

    let pendingImport!: Promise<void>;

    act(() => {
      pendingImport = result.current.importFile("log");
    });

    rerender("recording-b");
    await waitFor(() => expect(result.current.imports.log?.fileName).toBe("recording-b.log"));

    await act(async () => {
      finishImport({ status: "imported", timelineImport: logImport("recording-a", 9_000) });
      await pendingImport;
    });

    expect(result.current.imports.log?.fileName).toBe("recording-b.log");
    expect(result.current.busyKind).toBeNull();
  });
});
