// @vitest-environment jsdom

import { useEffect } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineImport, TimelineImportEntry, TimelineImportRowsPage } from "@path/shared";
import { useTimelineImportRows } from "../src/hooks/useTimelineImportRows";

const bridge = vi.hoisted(() => ({ listTimelineImportRows: vi.fn() }));
const translate = vi.hoisted(() => (key: string) => key);

vi.mock("next-intl", () => ({ useTranslations: () => translate }));
vi.mock("@/lib/Desktop", () => ({ getDesktopApi: () => ({ recordings: bridge }) }));

const timelineImport: TimelineImport = {
  kind: "log",
  fileName: "app.log",
  importedAt: "2026-09-14T11:00:00.000Z",
  offsetMs: 0,
  rowCount: 1,
  entryCount: 1,
  outsideCount: 0,
  unreadableLineCount: 0,
};

const entry: TimelineImportEntry = {
  id: 1,
  occurredAt: "2026-09-14T10:00:01.000Z",
  timestampMs: 1_000,
  text: "Current row",
};

function page(text = entry.text): TimelineImportRowsPage {
  return { start: 0, total: 1, entries: [{ ...entry, text }] };
}

function renderRows(query = "") {
  return renderHook(
    (currentQuery) => {
      const rows = useTimelineImportRows({
        recordingId: "recording-a",
        kind: "log",
        timelineImport,
        query: currentQuery,
      });

      const { loadRange } = rows;

      // The panel requests its visible range when the loading callback changes.
      useEffect(() => loadRange(0, 1), [loadRange]);

      return rows;
    },
    { initialProps: query },
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  bridge.listTimelineImportRows.mockResolvedValue(page());
});

afterEach(cleanup);

describe("timeline import row requests", () => {
  it.each(["", "match"])(
    "keeps a failed request visible without retrying for query %j",
    async (query) => {
      bridge.listTimelineImportRows.mockRejectedValueOnce(new Error("Rows unavailable"));
      const { result, rerender } = renderRows(query);

      await act(async () => {});

      expect(result.current.error).toBe("Rows unavailable");
      expect(bridge.listTimelineImportRows).toHaveBeenCalledOnce();

      rerender("new query");
      await act(async () => {});

      expect(result.current.error).toBeNull();
      expect(result.current.rowAt(0)?.text).toBe("Current row");
      expect(bridge.listTimelineImportRows).toHaveBeenCalledTimes(2);
    },
  );

  it.each(["success", "failure"])(
    "ignores an old %s after returning to the same query",
    async (outcome) => {
      let resolveOld!: (value: TimelineImportRowsPage) => void;
      let rejectOld!: (error: Error) => void;

      bridge.listTimelineImportRows.mockReturnValueOnce(
        new Promise<TimelineImportRowsPage>((resolve, reject) => {
          resolveOld = resolve;
          rejectOld = reject;
        }),
      );

      const { result, rerender } = renderRows("original");

      rerender("other");
      await act(async () => {});
      rerender("original");
      await act(async () => {});

      await act(async () => {
        if (outcome === "success") resolveOld(page("Stale row"));
        else rejectOld(new Error("Stale failure"));
      });

      expect(result.current.rowAt(0)?.text).toBe("Current row");
      expect(result.current.error).toBeNull();
      expect(bridge.listTimelineImportRows).toHaveBeenCalledTimes(3);
    },
  );
});
