import { useCallback } from "react";
import type { StartRecordingInput } from "@path/shared";
import { useRendererDispatch } from "./useRendererDispatch";
import { useRendererSelector } from "./useRendererSelector";
import { useRendererStore } from "./useRendererStore";
import {
  loadCaptureSources,
  pauseRecording,
  resumeRecording,
  setRecordingClickTracking,
  startRecording,
  stopRecording,
} from "../state/RecordingSlice";

/** Exposes the shared recording commands and the latest authoritative runtime snapshot. */
export function useRecording() {
  const dispatch = useRendererDispatch();
  const store = useRendererStore();
  const state = useRendererSelector((root) => root.recording);
  const loadSources = useCallback(() => dispatch(loadCaptureSources()), [dispatch]);
  const start = useCallback(
    async (input: StartRecordingInput) => {
      const result = await dispatch(startRecording(input));

      return startRecording.fulfilled.match(result) ? store.getState().recording.runtime : null;
    },
    [dispatch, store],
  );

  const stop = useCallback(() => dispatch(stopRecording()), [dispatch]);
  const pause = useCallback(() => dispatch(pauseRecording()), [dispatch]);
  const resume = useCallback(() => dispatch(resumeRecording()), [dispatch]);

  const setClickTracking = useCallback(
    (enabled: boolean) => dispatch(setRecordingClickTracking(enabled)),
    [dispatch],
  );

  return {
    snapshot: {
      ...state.runtime,
      sources: state.sources,
      error: state.runtime.error ?? state.sourceError,
      loadingSources: state.sourceRequestId !== null,
      isChangingRecording: state.commandRequestId !== null,
    },
    loadSources,
    start,
    stop,
    pause,
    resume,
    setClickTracking,
  };
}
