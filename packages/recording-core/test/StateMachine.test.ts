import { describe, expect, it } from "vitest";
import { transitionRecordingState } from "../src";

describe("transitionRecordingState", () => {
  it("moves through a complete recording lifecycle", () => {
    let state = transitionRecordingState("IDLE", "SELECT_REGION");

    state = transitionRecordingState(state, "REGION_SELECTED");
    state = transitionRecordingState(state, "PREPARED");

    state = transitionRecordingState(state, "STOP");
    state = transitionRecordingState(state, "STOPPED");

    // Final readiness follows both media processing and the optional evidence pipeline.
    state = transitionRecordingState(state, "VIDEO_PROCESSED");
    state = transitionRecordingState(state, "TRANSCRIBED");
    state = transitionRecordingState(state, "EVENTS_INDEXED");

    expect(state).toBe("READY");
  });

  it("rejects invalid transitions", () => {
    expect(() => transitionRecordingState("IDLE", "STOP")).toThrow("Invalid recording transition");
  });

  it("supports a recording-only lifecycle before transcription is installed", () => {
    let state = transitionRecordingState("IDLE", "PREPARE");

    state = transitionRecordingState(state, "PREPARED");
    state = transitionRecordingState(state, "STOP");
    state = transitionRecordingState(state, "STOPPED");

    state = transitionRecordingState(state, "SKIP_TRANSCRIPTION");

    expect(state).toBe("READY");
  });

  it("keeps video ready when transcription fails", () => {
    let state = transitionRecordingState("PROCESSING_VIDEO", "VIDEO_PROCESSED");

    state = transitionRecordingState(state, "TRANSCRIPTION_FAILED");

    expect(state).toBe("READY");
  });
});
