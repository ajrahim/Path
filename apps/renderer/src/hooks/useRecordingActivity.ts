import { useEffect, useMemo, useReducer, useRef } from "react";
import type { ClickEvent, RecordingStatus, TranscriptSegment } from "@path/shared";
import { clickActivityKey, mergeTimeline, transcriptActivityKey } from "@path/timeline";
import { getDesktopApi } from "@/lib/Desktop";
import { getErrorMessage } from "@/lib/ErrorMessage";

interface ActivityScope {
  recordingId: string | null;
  status: RecordingStatus | null;
}

interface ActivityMessages {
  analysisFailed: string;
  editFailed: string;
  removeFailed: string;
  revealFailed: string;
}

interface ActivityState {
  clicks: ClickEvent[];
  transcript: TranscriptSegment[];
  selectedActivityKey: string | null;
  pendingIds: string[];
  analyzingClicks: boolean;
  error: string | null;
}

interface ActivitySnapshot extends ActivityState {
  scope: ActivityScope;
}

type ActivityAction =
  | { type: "reset"; scope: ActivityScope }
  | { type: "loaded"; clicks: ClickEvent[]; transcript: TranscriptSegment[] }
  | { type: "analysis-started" }
  | { type: "analyzed"; clicks: ClickEvent[]; error: string | null }
  | { type: "analysis-failed"; error: string }
  | { type: "select"; key: string | null }
  | { type: "write-started"; id: string }
  | { type: "write-finished"; id: string }
  | { type: "transcript-updated"; segment: TranscriptSegment }
  | { type: "transcript-removed"; id: string }
  | { type: "click-removed"; id: string }
  | { type: "click-updated"; click: ClickEvent }
  | { type: "error"; error: string | null };

interface ActivitySession {
  scope: ActivityScope;
  active: boolean;
  writes: Promise<void>;
}

interface RecordingActivity extends ActivityState {
  selectActivity(key: string | null): void;
  saveTranscript(segment: TranscriptSegment, text: string): Promise<"saved" | "failed" | "stale">;
  saveClickDescription(click: ClickEvent, text: string): Promise<"saved" | "failed" | "stale">;
  removeTranscript(segment: TranscriptSegment): Promise<void>;
  removeClick(click: ClickEvent): Promise<boolean>;
  revealScreenshot(click: ClickEvent): Promise<void>;
  retryAnalysis(): Promise<void>;
}

function initialState(scope: ActivityScope): ActivitySnapshot {
  return {
    scope,
    clicks: [],
    transcript: [],
    selectedActivityKey: null,
    pendingIds: [],
    analyzingClicks: false,
    error: null,
  };
}

// Keep activity data, selection, and pending edits consistent within a single recording view.
function activityReducer(state: ActivitySnapshot, action: ActivityAction): ActivitySnapshot {
  switch (action.type) {
    case "reset":
      return initialState(action.scope);

    case "loaded": {
      const firstEntry = mergeTimeline(action.transcript, action.clicks)[0];
      const selectedActivityKey = firstEntry
        ? firstEntry.type === "click"
          ? clickActivityKey(firstEntry.click.id)
          : transcriptActivityKey(firstEntry.segment.id)
        : null;

      return {
        ...state,
        clicks: action.clicks,
        transcript: action.transcript,
        selectedActivityKey,
      };
    }

    case "analysis-started":
      return { ...state, analyzingClicks: true };

    case "analyzed": {
      const analyzed = new Map(action.clicks.map((click) => [click.id, click]));

      return {
        ...state,
        analyzingClicks: false,
        error: action.error ?? state.error,
        // Analysis owns descriptions; a late result must not resurrect deleted activity.
        clicks: state.clicks.map((click) => {
          const result = analyzed.get(click.id);

          return result ? { ...click, actionDescription: result.actionDescription } : click;
        }),
      };
    }

    case "analysis-failed":
      return { ...state, analyzingClicks: false, error: action.error };

    case "select":
      return { ...state, selectedActivityKey: action.key };

    case "write-started":
      return { ...state, pendingIds: [...state.pendingIds, action.id], error: null };

    case "write-finished": {
      const index = state.pendingIds.indexOf(action.id);

      return {
        ...state,
        pendingIds: state.pendingIds.filter((_, itemIndex) => itemIndex !== index),
      };
    }

    case "transcript-updated":
      return {
        ...state,
        transcript: state.transcript.map((segment) =>
          segment.id === action.segment.id ? action.segment : segment,
        ),
      };

    case "transcript-removed":
      return {
        ...state,
        transcript: state.transcript.filter((segment) => segment.id !== action.id),
        selectedActivityKey:
          state.selectedActivityKey === transcriptActivityKey(action.id)
            ? null
            : state.selectedActivityKey,
      };

    case "click-removed":
      return {
        ...state,
        clicks: state.clicks.filter((click) => click.id !== action.id),
        selectedActivityKey:
          state.selectedActivityKey === clickActivityKey(action.id)
            ? null
            : state.selectedActivityKey,
      };

    case "click-updated":
      return {
        ...state,
        clicks: state.clicks.map((click) => (click.id === action.click.id ? action.click : click)),
      };

    case "error":
      return { ...state, error: action.error };
  }
}

/** Owns the selected recording's activity, ordered edits, and analysis lifecycle. */
export function useRecordingActivity({
  recordingId,
  status,
  messages,
}: ActivityScope & { messages: ActivityMessages }): RecordingActivity {
  const scope = useMemo(() => ({ recordingId, status }), [recordingId, status]);
  const [snapshot, dispatch] = useReducer(activityReducer, scope, initialState);
  const sessionRef = useRef<ActivitySession | null>(null);
  const analysisFailed = messages.analysisFailed;
  const state = snapshot.scope === scope ? snapshot : initialState(scope);

  useEffect(() => {
    const session: ActivitySession = { scope, active: true, writes: Promise.resolve() };

    sessionRef.current = session;
    dispatch({ type: "reset", scope });
    const desktop = getDesktopApi();

    async function loadActivity(): Promise<void> {
      if (!scope.recordingId || !desktop) return;

      try {
        const [clicks, transcript] = await Promise.all([
          desktop.recordings.listClicks({ id: scope.recordingId }),
          desktop.recordings.listTranscript({ id: scope.recordingId }),
        ]);

        if (!session.active) return;

        dispatch({ type: "loaded", clicks, transcript });
        if (scope.status !== "ready" || clicks.length === 0) return;

        dispatch({ type: "analysis-started" });
        const result = await desktop.recordings.analyzeClicks({ id: scope.recordingId });

        if (!session.active) return;

        dispatch({
          type: "analyzed",
          clicks: result.clicks,
          error: result.failedCount > 0 && result.analyzedCount === 0 ? analysisFailed : null,
        });
      } catch (error) {
        if (session.active) {
          dispatch({ type: "analysis-failed", error: getErrorMessage(error, analysisFailed) });
        }
      }
    }

    void loadActivity();

    return () => {
      session.active = false;
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [scope, analysisFailed]);

  function currentSession(ownerId: string): ActivitySession | null {
    const session = sessionRef.current;

    return session?.active && session.scope === scope && scope.recordingId === ownerId
      ? session
      : null;
  }

  function isCurrent(session: ActivitySession): boolean {
    return session.active && sessionRef.current === session;
  }

  function queueWrite<T>(
    session: ActivitySession,
    id: string,
    write: () => Promise<T>,
  ): Promise<T> {
    dispatch({ type: "write-started", id });
    const result = session.writes.then(write);

    // Requested writes retain their original recording even if its view is closed.
    session.writes = result.then(
      () => undefined,
      () => undefined,
    );

    return result.finally(() => {
      if (isCurrent(session)) dispatch({ type: "write-finished", id });
    });
  }

  async function saveTranscript(
    segment: TranscriptSegment,
    text: string,
  ): Promise<"saved" | "failed" | "stale"> {
    const session = currentSession(segment.recordingId);
    const desktop = getDesktopApi();

    if (!session || !desktop) return "stale";

    try {
      const updated = await queueWrite(session, segment.id, () =>
        desktop.recordings.updateTranscript({
          recordingId: segment.recordingId,
          id: segment.id,
          text,
        }),
      );

      if (!isCurrent(session)) return "stale";

      if (updated.id !== segment.id || updated.recordingId !== segment.recordingId) {
        throw new Error(messages.editFailed);
      }

      dispatch({ type: "transcript-updated", segment: updated });

      return "saved";
    } catch (error) {
      if (!isCurrent(session)) return "stale";

      dispatch({ type: "error", error: getErrorMessage(error, messages.editFailed) });

      return "failed";
    }
  }

  async function saveClickDescription(
    click: ClickEvent,
    text: string,
  ): Promise<"saved" | "failed" | "stale"> {
    const session = currentSession(click.recordingId);
    const desktop = getDesktopApi();

    if (!session || !desktop) return "stale";

    try {
      const updated = await queueWrite(session, click.id, () =>
        desktop.recordings.updateClick({
          recordingId: click.recordingId,
          id: click.id,
          description: text,
        }),
      );

      if (!isCurrent(session)) return "stale";

      if (updated.id !== click.id || updated.recordingId !== click.recordingId) {
        throw new Error(messages.editFailed);
      }

      dispatch({ type: "click-updated", click: updated });

      return "saved";
    } catch (error) {
      if (!isCurrent(session)) return "stale";

      dispatch({ type: "error", error: getErrorMessage(error, messages.editFailed) });

      return "failed";
    }
  }

  async function retryAnalysis(): Promise<void> {
    const session = sessionRef.current;
    const desktop = getDesktopApi();

    // Analysis only reruns for its own recording while no analysis is already in flight.
    if (!session || !isCurrent(session) || !scope.recordingId || !desktop) return;

    if (scope.status !== "ready" || snapshot.analyzingClicks) return;

    dispatch({ type: "analysis-started" });
    dispatch({ type: "error", error: null });

    try {
      const result = await desktop.recordings.analyzeClicks({ id: scope.recordingId });

      if (!isCurrent(session)) return;

      dispatch({
        type: "analyzed",
        clicks: result.clicks,
        error: result.failedCount > 0 && result.analyzedCount === 0 ? analysisFailed : null,
      });
    } catch (error) {
      if (isCurrent(session)) {
        dispatch({ type: "analysis-failed", error: getErrorMessage(error, analysisFailed) });
      }
    }
  }

  async function removeTranscript(segment: TranscriptSegment): Promise<void> {
    const session = currentSession(segment.recordingId);
    const desktop = getDesktopApi();

    if (!session || !desktop) return;

    try {
      await queueWrite(session, segment.id, () =>
        desktop.recordings.deleteTranscript({ recordingId: segment.recordingId, id: segment.id }),
      );
      if (isCurrent(session)) dispatch({ type: "transcript-removed", id: segment.id });
    } catch (error) {
      if (isCurrent(session)) {
        dispatch({ type: "error", error: getErrorMessage(error, messages.removeFailed) });
      }
    }
  }

  async function removeClick(click: ClickEvent): Promise<boolean> {
    const session = currentSession(click.recordingId);
    const desktop = getDesktopApi();

    if (!session || !desktop) return false;

    try {
      await queueWrite(session, click.id, () =>
        desktop.recordings.deleteClick({ recordingId: click.recordingId, id: click.id }),
      );
      if (!isCurrent(session)) return false;

      dispatch({ type: "click-removed", id: click.id });

      return true;
    } catch (error) {
      if (isCurrent(session)) {
        dispatch({ type: "error", error: getErrorMessage(error, messages.removeFailed) });
      }

      return false;
    }
  }

  async function revealScreenshot(click: ClickEvent): Promise<void> {
    const session = currentSession(click.recordingId);

    if (!session) return;

    dispatch({ type: "error", error: null });

    try {
      const desktop = getDesktopApi();

      if (!desktop) throw new Error("Desktop API is unavailable");

      await desktop.recordings.revealScreenshot({
        recordingId: click.recordingId,
        clickId: click.id,
      });
    } catch (error) {
      if (isCurrent(session)) {
        dispatch({ type: "error", error: getErrorMessage(error, messages.revealFailed) });
      }
    }
  }

  return {
    clicks: state.clicks,
    transcript: state.transcript,
    selectedActivityKey: state.selectedActivityKey,
    pendingIds: state.pendingIds,
    analyzingClicks: state.analyzingClicks,
    error: state.error,
    selectActivity: (key) => dispatch({ type: "select", key }),
    saveTranscript,
    saveClickDescription,
    removeTranscript,
    removeClick,
    revealScreenshot,
    retryAnalysis,
  };
}
