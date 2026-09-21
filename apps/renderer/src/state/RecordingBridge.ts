import { nanoid } from "@reduxjs/toolkit";
import { isActiveRecordingStatus, type DesktopApi, type RecordingRuntimeState } from "@path/shared";
import {
  connectionClosed,
  connectionOpened,
  runtimeReadFailed,
  runtimeReceived,
} from "@/state/RecordingSlice";
import type { RendererStore } from "./RendererStore";

/** Owns one window's runtime subscription and polling fallback until its controls unmount. */
export function connectRecordingBridge(
  store: RendererStore,
  desktop: DesktopApi | null,
): () => void {
  if (!desktop) return () => {};

  const connectionId = nanoid();
  let isConnected = true;
  let isReadPending = false;

  store.dispatch(connectionOpened(connectionId));

  function receiveRuntime(runtime: RecordingRuntimeState): void {
    if (!isConnected) return;

    const { revision } = store.getState().recording;

    store.dispatch(runtimeReceived({ runtime, connectionId, revision }));
  }

  async function refreshRuntime(): Promise<void> {
    if (!desktop || isReadPending || store.getState().recording.commandRequestId) return;

    isReadPending = true;
    // A reply is accepted only if no pushed event or recording command superseded this read.
    const { revision } = store.getState().recording;

    try {
      const runtime = await desktop.recording.getState();

      if (isConnected && !store.getState().recording.commandRequestId) {
        store.dispatch(runtimeReceived({ runtime, connectionId, revision }));
      }
    } catch (error) {
      if (isConnected && !store.getState().recording.commandRequestId) {
        store.dispatch(
          runtimeReadFailed({
            connectionId,
            revision,
            error: error instanceof Error ? error.message : "Unable to refresh recording state",
          }),
        );
      }
    } finally {
      isReadPending = false;
    }
  }

  const removeStateListener = desktop.recording.onStateChanged(receiveRuntime);

  void refreshRuntime();
  const timer = setInterval(() => {
    if (isActiveRecordingStatus(store.getState().recording.runtime.status)) {
      void refreshRuntime();
    }
  }, 500);

  return () => {
    isConnected = false;
    clearInterval(timer);
    removeStateListener();
    store.dispatch(connectionClosed(connectionId));
  };
}
