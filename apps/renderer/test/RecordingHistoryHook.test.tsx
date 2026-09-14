// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi, RecordingSummary } from "@path/shared";
import { createRendererStore } from "../src/state/RendererStore";
import { refreshHistory } from "../src/state/HistorySlice";
import { useRecordingHistory } from "../src/hooks/useRecordingHistory";

const existing: RecordingSummary = {
  id: "existing",
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

afterEach(cleanup);

describe("history mutation synchronization", () => {
  it.each(["rename", "remove"] as const)(
    "refreshes newly completed recordings after %s invalidates a pending list",
    async (operation) => {
      const completed = { ...existing, id: "completed", title: "Just completed" };
      const renamed = { ...existing, title: "Renamed" };
      const pendingList = Promise.withResolvers<RecordingSummary[]>();
      const persisted = operation === "rename" ? [renamed, completed] : [completed];
      const recordings = {
        list: vi
          .fn()
          .mockResolvedValueOnce([existing])
          .mockReturnValueOnce(pendingList.promise)
          .mockResolvedValue(persisted),
        rename: vi.fn().mockResolvedValue(renamed),
        delete: vi.fn().mockResolvedValue(undefined),
      };

      const desktop = { recordings } as unknown as DesktopApi;
      const store = createRendererStore({ getDesktopApi: () => desktop });

      await store.dispatch(refreshHistory());
      const staleRefresh = store.dispatch(refreshHistory());
      const { result } = renderHook(useRecordingHistory, {
        wrapper: ({ children }: { children: ReactNode }) => (
          <Provider store={store}>{children}</Provider>
        ),
      });

      await act(async () => {
        if (operation === "rename") await result.current.rename(existing.id, renamed.title);
        else await result.current.remove(existing.id);

        pendingList.resolve([existing, completed]);
        await staleRefresh;
      });

      expect(recordings.list).toHaveBeenCalledTimes(3);
      expect(result.current.snapshot.recordings).toEqual(persisted);
    },
  );
});
