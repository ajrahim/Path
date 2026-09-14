import { describe, expect, it, vi } from "vitest";
import type { DesktopApi, RecordingSummary } from "@path/shared";
import { createRendererStore } from "../src/state/RendererStore";
import {
  deleteHistoryRecording,
  refreshHistory,
  renameHistoryRecording,
} from "../src/state/HistorySlice";

const recording: RecordingSummary = {
  id: "recording-1",
  title: "Original",
  status: "ready",
  captureMode: "display",
  durationMs: 1_000,
  thumbnailPath: null,
  startedAt: "2026-09-14T10:00:00Z",
  completedAt: "2026-09-14T10:00:01Z",
  createdAt: "2026-09-14T10:00:00Z",
  updatedAt: "2026-09-14T10:00:01Z",
  transcriptStatus: "ready",
};

function historyHarness() {
  const recordings = {
    list: vi.fn().mockResolvedValue([recording]),
    rename: vi.fn().mockResolvedValue({ ...recording, title: "Renamed" }),
    delete: vi.fn().mockResolvedValue(undefined),
  };

  const desktop = { recordings } as unknown as DesktopApi;

  return { recordings, store: createRendererStore({ getDesktopApi: () => desktop }) };
}

describe("recording history ordering", () => {
  it("uses the newest refresh when responses arrive out of order", async () => {
    const { recordings, store } = historyHarness();
    const stale = Promise.withResolvers<RecordingSummary[]>();

    recordings.list.mockReturnValueOnce(stale.promise);
    const first = store.dispatch(refreshHistory());

    await store.dispatch(refreshHistory());
    stale.resolve([]);
    await first;

    expect(store.getState().history.recordings).toEqual([recording]);
    expect(store.getState().history.status).toBe("ready");
  });

  it("does not restore a deleted recording from an earlier refresh", async () => {
    const { recordings, store } = historyHarness();

    await store.dispatch(refreshHistory());
    const stale = Promise.withResolvers<RecordingSummary[]>();

    recordings.list.mockReturnValueOnce(stale.promise);
    const refresh = store.dispatch(refreshHistory());

    await store.dispatch(deleteHistoryRecording({ id: recording.id })).unwrap();
    stale.resolve([recording]);
    await refresh;

    expect(store.getState().history.recordings).toEqual([]);
  });

  it("does not replace a persisted rename with an older title", async () => {
    const { recordings, store } = historyHarness();

    await store.dispatch(refreshHistory());
    const stale = Promise.withResolvers<RecordingSummary[]>();

    recordings.list.mockReturnValueOnce(stale.promise);
    const refresh = store.dispatch(refreshHistory());

    await store.dispatch(renameHistoryRecording({ id: recording.id, title: "Renamed" })).unwrap();
    stale.resolve([recording]);
    await refresh;

    expect(store.getState().history.recordings[0]?.title).toBe("Renamed");
  });

  it("retains history after a failed deletion and releases its mutation guard", async () => {
    const { recordings, store } = historyHarness();

    await store.dispatch(refreshHistory());
    recordings.delete.mockRejectedValueOnce(new Error("Disk unavailable"));
    await expect(
      store.dispatch(deleteHistoryRecording({ id: recording.id })).unwrap(),
    ).rejects.toBe("Disk unavailable");

    expect(store.getState().history.recordings).toEqual([recording]);

    await store.dispatch(deleteHistoryRecording({ id: recording.id })).unwrap();

    expect(recordings.delete).toHaveBeenCalledTimes(2);
  });

  it("does not issue overlapping mutations for the same recording", async () => {
    const { recordings, store } = historyHarness();
    const pendingRename = Promise.withResolvers<RecordingSummary>();

    recordings.rename.mockReturnValue(pendingRename.promise);
    const rename = store.dispatch(renameHistoryRecording({ id: recording.id, title: "Renamed" }));
    const removal = await store.dispatch(deleteHistoryRecording({ id: recording.id }));

    expect(removal.meta.requestStatus).toBe("rejected");
    expect(recordings.delete).not.toHaveBeenCalled();

    pendingRename.resolve({ ...recording, title: "Renamed" });
    await rename;

    expect(store.getState().history.mutationRequestIds).toEqual({});
  });
});
