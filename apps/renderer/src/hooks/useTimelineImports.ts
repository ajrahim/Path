import { useEffect, useMemo, useReducer, useRef } from "react";
import { useTranslations } from "next-intl";
import type { RecordingTimeWindow, TimelineImport, TimelineImportKind } from "@path/shared";
import { getDesktopApi } from "@/lib/Desktop";

interface ImportScope {
  recordingId: string | null;
  durationMs: number | null;
}

interface TimelineImportsState {
  window: RecordingTimeWindow | null;
  imports: Record<TimelineImportKind, TimelineImport | null>;
  isLoading: boolean;
  busyKind: TimelineImportKind | null;
  errors: Record<TimelineImportKind, string | null>;
}

interface TimelineImportsSnapshot extends TimelineImportsState {
  scope: ImportScope;
}

type TimelineImportsAction =
  | { type: "reset"; scope: ImportScope; isLoading: boolean }
  | {
      type: "loaded";
      window: RecordingTimeWindow | null;
      imports: Record<TimelineImportKind, TimelineImport | null>;
    }
  | { type: "load-failed"; error: string }
  | { type: "operation-started"; kind: TimelineImportKind }
  | { type: "import-changed"; kind: TimelineImportKind; timelineImport: TimelineImport | null }
  | { type: "operation-finished"; kind: TimelineImportKind; error: string | null };

export interface TimelineImports extends TimelineImportsState {
  importFile(kind: TimelineImportKind): Promise<void>;
  updateOffset(kind: TimelineImportKind, offsetMs: number): Promise<void>;
  removeImport(kind: TimelineImportKind): Promise<void>;
}

function initialState(scope: ImportScope, isLoading = false): TimelineImportsSnapshot {
  return {
    scope,
    window: null,
    imports: { log: null, element: null },
    isLoading,
    busyKind: null,
    errors: { log: null, element: null },
  };
}

function timelineImportsReducer(
  state: TimelineImportsSnapshot,
  action: TimelineImportsAction,
): TimelineImportsSnapshot {
  switch (action.type) {
    case "reset":
      return initialState(action.scope, action.isLoading);

    case "loaded":
      return { ...state, window: action.window, imports: action.imports, isLoading: false };

    case "load-failed":
      return {
        ...state,
        isLoading: false,
        errors: { log: action.error, element: action.error },
      };

    case "operation-started":
      return {
        ...state,
        busyKind: action.kind,
        errors: { ...state.errors, [action.kind]: null },
      };

    case "import-changed":
      return { ...state, imports: { ...state.imports, [action.kind]: action.timelineImport } };

    case "operation-finished":
      return {
        ...state,
        busyKind: null,
        errors: { ...state.errors, [action.kind]: action.error },
      };
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Owns the selected recording's imported logs and elements; one operation runs at a time. */
export function useTimelineImports({ recordingId, durationMs }: ImportScope): TimelineImports {
  const t = useTranslations("recording");
  const scope = useMemo(() => ({ recordingId, durationMs }), [recordingId, durationMs]);
  const [snapshot, dispatch] = useReducer(timelineImportsReducer, scope, initialState);
  const sessionRef = useRef<{ scope: ImportScope; active: boolean } | null>(null);
  // The immediate lock also covers repeated events before React renders the busy state.
  const operationRef = useRef(false);
  const loadFailed = t("importLoadFailed");
  const state = snapshot.scope === scope ? snapshot : initialState(scope);

  useEffect(() => {
    const session = { scope, active: true };
    const desktop = getDesktopApi();
    const canLoad = Boolean(scope.recordingId && desktop);

    sessionRef.current = session;
    operationRef.current = false;
    dispatch({ type: "reset", scope, isLoading: canLoad });

    async function loadImports(): Promise<void> {
      if (!scope.recordingId || !desktop) return;

      try {
        const result = await desktop.recordings.listTimelineImports({ id: scope.recordingId });

        if (!session.active) return;

        dispatch({
          type: "loaded",
          window: result.window,
          imports: { log: result.log, element: result.element },
        });
      } catch (error) {
        if (session.active) {
          dispatch({ type: "load-failed", error: errorMessage(error, loadFailed) });
        }
      }
    }

    void loadImports();

    return () => {
      session.active = false;
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [scope, loadFailed]);

  async function runOperation(
    kind: TimelineImportKind,
    failureMessage: string,
    operation: (recordingId: string) => Promise<string | null>,
  ): Promise<void> {
    const session = sessionRef.current;

    if (!session?.active || !scope.recordingId || operationRef.current) return;

    operationRef.current = true;
    dispatch({ type: "operation-started", kind });

    let error: string | null = null;

    try {
      error = await operation(scope.recordingId);
    } catch (caught) {
      error = errorMessage(caught, failureMessage);
    }

    // A completion for a recording that is no longer selected must not touch the new view.
    if (!session.active) return;

    operationRef.current = false;
    dispatch({ type: "operation-finished", kind, error });
  }

  async function importFile(kind: TimelineImportKind): Promise<void> {
    const desktop = getDesktopApi();

    if (!desktop) return;

    await runOperation(kind, t("importFailed"), async (id) => {
      const result = await desktop.recordings.importTimelineFile({ recordingId: id, kind });

      if (result.status === "canceled") return null;
      if (result.status === "too-large") {
        return t("importTooLarge", { limit: result.maxFileSizeMb });
      }

      if (result.status === "no-rows") return t("importNoRows");

      if (sessionRef.current?.scope.recordingId === id) {
        dispatch({ type: "import-changed", kind, timelineImport: result.timelineImport });
      }

      return null;
    });
  }

  async function updateOffset(kind: TimelineImportKind, offsetMs: number): Promise<void> {
    const desktop = getDesktopApi();

    if (!desktop || state.imports[kind]?.offsetMs === offsetMs) return;

    await runOperation(kind, t("importOffsetFailed"), async (id) => {
      const timelineImport = await desktop.recordings.updateTimelineImportOffset({
        recordingId: id,
        kind,
        offsetMs,
      });

      if (sessionRef.current?.scope.recordingId === id) {
        dispatch({ type: "import-changed", kind, timelineImport });
      }

      return null;
    });
  }

  async function removeImport(kind: TimelineImportKind): Promise<void> {
    const desktop = getDesktopApi();

    if (!desktop) return;

    await runOperation(kind, t("importRemoveFailed"), async (id) => {
      await desktop.recordings.removeTimelineImport({ recordingId: id, kind });

      if (sessionRef.current?.scope.recordingId === id) {
        dispatch({ type: "import-changed", kind, timelineImport: null });
      }

      return null;
    });
  }

  return {
    window: state.window,
    imports: state.imports,
    isLoading: state.isLoading,
    busyKind: state.busyKind,
    errors: state.errors,
    importFile,
    updateOffset,
    removeImport,
  };
}
