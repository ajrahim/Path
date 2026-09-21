import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi, RecordingRuntimeState, StartRecordingInput } from "@path/shared";
import { createRendererStore } from "../src/state/RendererStore";
import { connectRecordingBridge } from "../src/state/RecordingBridge";
import {
  loadCaptureSources,
  pauseRecording,
  resumeRecording,
  startRecording,
  stopRecording,
} from "../src/state/RecordingSlice";

const idle: RecordingRuntimeState = {
  status: "idle",
  recordingId: null,
  elapsedMs: 0,
  captureClicks: false,
  error: null,
};

const recording: RecordingRuntimeState = {
  ...idle,
  status: "recording",
  recordingId: "recording-1",
};

const startInput: StartRecordingInput = {
  sourceId: "screen:1",
  title: "Walkthrough",
  captureMode: "display",
  includeMicrophone: false,
  captureClicks: true,
};

function recordingHarness() {
  const recordingApi: DesktopApi["recording"] = {
    getState: vi.fn().mockResolvedValue(idle),
    onStateChanged: vi.fn().mockReturnValue(vi.fn()),
    listSources: vi.fn().mockResolvedValue([]),
    start: vi.fn().mockResolvedValue(recording),
    stop: vi.fn().mockResolvedValue(idle),
    pause: vi.fn().mockResolvedValue({ ...recording, status: "paused" as const }),
    resume: vi.fn().mockResolvedValue(recording),
    setClickTracking: vi.fn().mockResolvedValue(recording),
    selectRegion: vi.fn(),
  };

  const desktop = { recording: recordingApi } as DesktopApi;
  const store = createRendererStore({ getDesktopApi: () => desktop });

  return { recordingApi, desktop, store };
}

let disconnect: (() => void) | undefined;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  disconnect?.();
  disconnect = undefined;
  vi.useRealTimers();
});

describe("recording bridge lifecycle", () => {
  it("ignores an older initial read after a pushed recording event", async () => {
    const { recordingApi, desktop, store } = recordingHarness();
    const pendingRead = Promise.withResolvers<RecordingRuntimeState>();

    vi.mocked(recordingApi.getState).mockReturnValue(pendingRead.promise);
    disconnect = connectRecordingBridge(store, desktop);

    vi.mocked(recordingApi.onStateChanged).mock.calls[0]![0](recording);
    pendingRead.resolve(idle);
    await pendingRead.promise;

    expect(store.getState().recording.runtime).toEqual(recording);
  });

  it("reconnects while ignoring reads and events from the disposed connection", async () => {
    const { recordingApi, desktop, store } = recordingHarness();
    const oldRead = Promise.withResolvers<RecordingRuntimeState>();
    const removeListener = vi.fn();

    vi.mocked(recordingApi.getState).mockReturnValueOnce(oldRead.promise);
    vi.mocked(recordingApi.onStateChanged).mockReturnValue(removeListener);
    const removeFirst = connectRecordingBridge(store, desktop);
    const oldListener = vi.mocked(recordingApi.onStateChanged).mock.calls[0]![0];

    removeFirst();
    disconnect = connectRecordingBridge(store, desktop);
    await vi.advanceTimersByTimeAsync(0);

    oldListener(recording);
    oldRead.resolve(recording);
    await oldRead.promise;

    expect(store.getState().recording.runtime).toEqual(idle);
    expect(removeListener).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);

    disconnect();
    disconnect = undefined;

    expect(vi.getTimerCount()).toBe(0);
  });

  it("serializes polling and polls only while recording work is active", async () => {
    const { recordingApi, desktop, store } = recordingHarness();

    disconnect = connectRecordingBridge(store, desktop);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(recordingApi.getState).toHaveBeenCalledTimes(1);

    vi.mocked(recordingApi.onStateChanged).mock.calls[0]![0](recording);
    const poll = Promise.withResolvers<RecordingRuntimeState>();

    vi.mocked(recordingApi.getState).mockReturnValue(poll.promise);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(recordingApi.getState).toHaveBeenCalledTimes(2);

    poll.resolve(recording);
    await poll.promise;
  });

  it("keeps polling failures in state without detached rejections", async () => {
    const { recordingApi, desktop, store } = recordingHarness();

    vi.mocked(recordingApi.getState).mockRejectedValue(new Error("Bridge unavailable"));
    disconnect = connectRecordingBridge(store, desktop);
    await vi.advanceTimersByTimeAsync(0);

    expect(store.getState().recording.runtime.error).toBe("Bridge unavailable");

    vi.mocked(recordingApi.stop).mockRejectedValue(new Error("Stop failed"));
    await store.dispatch(stopRecording());

    expect(store.getState().recording.runtime.error).toBe("Stop failed");
  });
});

describe("recording commands", () => {
  it("does not let an in-flight poll invalidate a newer start response", async () => {
    const { recordingApi, desktop, store } = recordingHarness();
    const poll = Promise.withResolvers<RecordingRuntimeState>();
    const command = Promise.withResolvers<RecordingRuntimeState>();

    vi.mocked(recordingApi.getState).mockReturnValue(poll.promise);
    vi.mocked(recordingApi.start).mockReturnValue(command.promise);
    disconnect = connectRecordingBridge(store, desktop);
    const request = store.dispatch(startRecording(startInput));

    poll.resolve(idle);
    await poll.promise;
    command.resolve(recording);
    await request;

    expect(store.getState().recording.runtime).toEqual(recording);
  });

  it("preserves newer events when an older start request resolves", async () => {
    const { recordingApi, desktop, store } = recordingHarness();

    disconnect = connectRecordingBridge(store, desktop);
    await vi.advanceTimersByTimeAsync(0);
    const command = Promise.withResolvers<RecordingRuntimeState>();

    vi.mocked(recordingApi.start).mockReturnValue(command.promise);
    const request = store.dispatch(startRecording(startInput));
    const ready = { ...recording, status: "ready" as const };

    vi.mocked(recordingApi.onStateChanged).mock.calls[0]![0](ready);
    command.resolve(recording);
    await request;

    expect(store.getState().recording.runtime).toEqual(ready);
    expect(store.getState().recording.commandRequestId).toBeNull();
  });

  it("recovers main's state after a failed start without inventing an idle session", async () => {
    const { recordingApi, store } = recordingHarness();

    vi.mocked(recordingApi.start).mockRejectedValue(new Error("Preparation failed"));
    vi.mocked(recordingApi.getState).mockResolvedValue(recording);
    await store.dispatch(startRecording(startInput));

    expect(store.getState().recording.runtime).toEqual({
      ...recording,
      error: "Preparation failed",
    });
  });

  it("applies pause and resume replies to the shared runtime snapshot", async () => {
    const { recordingApi, desktop, store } = recordingHarness();

    disconnect = connectRecordingBridge(store, desktop);
    await store.dispatch(startRecording(startInput));

    expect(store.getState().recording.runtime.status).toBe("recording");

    await store.dispatch(pauseRecording());

    expect(recordingApi.pause).toHaveBeenCalledTimes(1);
    expect(store.getState().recording.runtime.status).toBe("paused");

    await store.dispatch(resumeRecording());

    expect(recordingApi.resume).toHaveBeenCalledTimes(1);
    expect(store.getState().recording.runtime).toEqual(recording);
  });

  it("keeps source discovery isolated and ignores superseded source requests", async () => {
    const { recordingApi, store } = recordingHarness();
    const stale =
      Promise.withResolvers<Awaited<ReturnType<DesktopApi["recording"]["listSources"]>>>();

    vi.mocked(recordingApi.listSources).mockReturnValueOnce(stale.promise);
    const first = store.dispatch(loadCaptureSources());

    await store.dispatch(loadCaptureSources());
    stale.reject(new Error("Old discovery failed"));
    await first;

    expect(store.getState().recording.sourceError).toBeNull();
    expect(store.getState().recording.sourceRequestId).toBeNull();

    const otherWindow = createRendererStore({ getDesktopApi: () => null });

    expect(otherWindow.getState().recording.runtime).toEqual(idle);
  });
});
