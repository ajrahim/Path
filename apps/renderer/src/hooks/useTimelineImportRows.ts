import { useCallback, useEffect, useReducer, useRef } from "react";
import { useTranslations } from "next-intl";
import type { TimelineImport, TimelineImportEntry, TimelineImportKind } from "@path/shared";
import { getDesktopApi } from "@/lib/Desktop";

// Rows fetched per request; well under the bridge's page limit.
const ROWS_PER_PAGE = 200;

// Pages kept in memory; older pages are dropped and fetched again if scrolled back into view.
const MAX_CACHED_PAGES = 20;

interface RowsScope {
  recordingId: string | null;
  kind: TimelineImportKind;
  timelineImport: TimelineImport | null;
  /** Trimmed search text; an empty string shows every row inside the video. */
  query: string;
}

interface RowsState {
  scopeKey: string;
  pages: Map<number, TimelineImportEntry[]>;
  /** Matching rows; unknown until the first filtered page answers. */
  total: number | null;
  error: string | null;
}

type RowsAction =
  | { type: "reset"; scopeKey: string; total: number | null }
  | { type: "page"; scopeKey: string; page: number; entries: TimelineImportEntry[]; total: number }
  | { type: "failed"; scopeKey: string; error: string };

function reduceRows(state: RowsState, action: RowsAction): RowsState {
  if (action.type === "reset") {
    return { scopeKey: action.scopeKey, pages: new Map(), total: action.total, error: null };
  }

  // A response for an earlier import, offset, or query must not change the current view.
  if (action.scopeKey !== state.scopeKey) return state;

  if (action.type === "failed") return { ...state, error: action.error };

  const pages = new Map(state.pages);

  pages.set(action.page, action.entries);

  while (pages.size > MAX_CACHED_PAGES) {
    const oldest = pages.keys().next().value;

    if (oldest === undefined || oldest === action.page) break;
    pages.delete(oldest);
  }

  return { ...state, pages, total: action.total, error: null };
}

export interface TimelineImportRows {
  total: number;
  isCounting: boolean;
  error: string | null;
  rowAt(index: number): TimelineImportEntry | undefined;
  /** Fetches the pages covering rows `start` to `end` (exclusive) that are not cached. */
  loadRange(start: number, end: number): void;
  /** Index of the last matching row at or before a media time, or -1. */
  locate(timestampMs: number): Promise<number>;
}

function scopeKeyOf({ recordingId, kind, timelineImport, query }: RowsScope): string {
  if (!recordingId || !timelineImport) return "";

  return JSON.stringify([
    recordingId,
    kind,
    timelineImport.importedAt,
    timelineImport.offsetMs,
    timelineImport.entryCount,
    query,
  ]);
}

/**
 * Reads one import's rows a page at a time. Only the rows a list shows are requested, the cache
 * is bounded, and searching runs in the desktop against every stored row.
 */
export function useTimelineImportRows(scope: RowsScope): TimelineImportRows {
  const t = useTranslations("recording");
  const scopeKey = scopeKeyOf(scope);
  const unfilteredTotal = scope.query ? null : (scope.timelineImport?.entryCount ?? 0);
  const [state, dispatch] = useReducer(reduceRows, {
    scopeKey,
    pages: new Map(),
    total: unfilteredTotal,
    error: null,
  });

  const inFlightRef = useRef(new Set<string>());
  const loadFailed = t("importLoadFailed");
  const { recordingId, kind, query } = scope;

  useEffect(() => {
    inFlightRef.current.clear();
    dispatch({ type: "reset", scopeKey, total: unfilteredTotal });
  }, [scopeKey, unfilteredTotal]);

  const current = state.scopeKey === scopeKey ? state : null;

  const loadRange = useCallback(
    (start: number, end: number) => {
      const desktop = getDesktopApi();

      if (!desktop || !recordingId || !scopeKey) return;

      const firstPage = Math.floor(start / ROWS_PER_PAGE);
      const lastPage = Math.floor(Math.max(start, end - 1) / ROWS_PER_PAGE);

      for (let page = firstPage; page <= lastPage; page += 1) {
        const requestKey = `${scopeKey}#${page}`;

        if (current?.pages.has(page) || inFlightRef.current.has(requestKey)) continue;

        inFlightRef.current.add(requestKey);
        desktop.recordings
          .listTimelineImportRows({
            recordingId,
            kind,
            start: page * ROWS_PER_PAGE,
            limit: ROWS_PER_PAGE,
            ...(query ? { query } : {}),
          })
          .then(
            (result) =>
              dispatch({
                type: "page",
                scopeKey,
                page,
                entries: result.entries,
                total: result.total,
              }),
            (error: unknown) =>
              dispatch({
                type: "failed",
                scopeKey,
                error: error instanceof Error && error.message ? error.message : loadFailed,
              }),
          )
          .finally(() => inFlightRef.current.delete(requestKey));
      }
    },
    [scopeKey, current, loadFailed, recordingId, kind, query],
  );

  // A filtered search learns its total from its first page.
  useEffect(() => {
    if (current && current.total === null) loadRange(0, 1);
  }, [current, loadRange]);

  const locate = useCallback(
    async (timestampMs: number): Promise<number> => {
      const desktop = getDesktopApi();

      if (!desktop || !recordingId) return -1;

      const { index } = await desktop.recordings.locateTimelineImportRow({
        recordingId,
        kind,
        timestampMs: Math.max(0, Math.round(timestampMs)),
        ...(query ? { query } : {}),
      });

      return index;
    },
    [recordingId, kind, query],
  );

  return {
    total: current?.total ?? 0,
    isCounting: current?.total === null,
    error: current?.error ?? null,
    rowAt: (index) =>
      current?.pages.get(Math.floor(index / ROWS_PER_PAGE))?.[index % ROWS_PER_PAGE],
    loadRange,
    locate,
  };
}
