/** Internal lifecycle states are finer-grained than the snapshots shown in the renderer. */
export type RecordingState =
  | "IDLE"
  | "SELECTING_REGION"
  | "PREPARING"
  | "RECORDING"
  | "PAUSED"
  | "STOPPING"
  | "PROCESSING_VIDEO"
  | "TRANSCRIBING"
  | "INDEXING_EVENTS"
  | "READY"
  | "FAILED";

export type RecordingEvent =
  | "PREPARE"
  | "SELECT_REGION"
  | "REGION_SELECTED"
  | "PREPARED"
  | "PAUSE"
  | "RESUME"
  | "STOP"
  | "STOPPED"
  | "VIDEO_PROCESSED"
  | "SKIP_TRANSCRIPTION"
  | "TRANSCRIPTION_FAILED"
  | "TRANSCRIBED"
  | "EVENTS_INDEXED"
  | "FAIL"
  | "RESET";

// Missing edges are invalid operations, rather than implicit no-op transitions.
const transitions: Partial<
  Record<RecordingState, Partial<Record<RecordingEvent, RecordingState>>>
> = {
  IDLE: { PREPARE: "PREPARING", SELECT_REGION: "SELECTING_REGION" },
  SELECTING_REGION: { REGION_SELECTED: "PREPARING", RESET: "IDLE" },
  PREPARING: { PREPARED: "RECORDING", FAIL: "FAILED" },
  RECORDING: { PAUSE: "PAUSED", STOP: "STOPPING", FAIL: "FAILED" },
  PAUSED: { RESUME: "RECORDING", STOP: "STOPPING", FAIL: "FAILED" },
  STOPPING: { STOPPED: "PROCESSING_VIDEO", FAIL: "FAILED" },
  PROCESSING_VIDEO: {
    VIDEO_PROCESSED: "TRANSCRIBING",
    SKIP_TRANSCRIPTION: "READY",
    FAIL: "FAILED",
  },
  TRANSCRIBING: { TRANSCRIBED: "INDEXING_EVENTS", TRANSCRIPTION_FAILED: "READY", FAIL: "FAILED" },
  INDEXING_EVENTS: { EVENTS_INDEXED: "READY", FAIL: "FAILED" },
  READY: { RESET: "IDLE" },
  FAILED: { RESET: "IDLE" },
};

/** Resolve one legal lifecycle transition without mutating state or performing capture work. */
export function transitionRecordingState(
  state: RecordingState,
  event: RecordingEvent,
): RecordingState {
  const nextState = transitions[state]?.[event];

  if (!nextState) {
    throw new Error(`Invalid recording transition: ${state} -> ${event}`);
  }

  return nextState;
}
