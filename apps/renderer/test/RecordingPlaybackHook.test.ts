// @vitest-environment jsdom

import { createElement, useLayoutEffect, type SyntheticEvent } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRecordingPlayback } from "../src/hooks/useRecordingPlayback";

type Playback = ReturnType<typeof useRecordingPlayback>;

type PlaybackProps = Parameters<typeof useRecordingPlayback>[0];

class TestResizeObserver implements ResizeObserver {
  static instances: TestResizeObserver[] = [];
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();

  constructor(readonly callback: ResizeObserverCallback) {
    TestResizeObserver.instances.push(this);
  }
}

function PlaybackHarness({
  onChange,
  ...props
}: PlaybackProps & { onChange(playback: Playback): void }) {
  const playback = useRecordingPlayback(props);

  useLayoutEffect(() => onChange(playback), [onChange, playback]);

  return createElement("video", {
    ref: playback.videoRef,
    src: props.mediaUrl ?? undefined,
    onPlay: () => playback.setPlaying(true),
    onPause: () => playback.setPlaying(false),
    onTimeUpdate: (event: SyntheticEvent<HTMLVideoElement>) =>
      playback.setCurrentTime(event.currentTarget.currentTime),
    onLoadedMetadata: (event: SyntheticEvent<HTMLVideoElement>) =>
      playback.setDuration(event.currentTarget.duration),
  });
}

function mountPlayback() {
  const onChange = vi.fn<(playback: Playback) => void>();
  const props = {
    recordingId: "recording-a",
    mediaUrl: "blob:recording-a",
    durationMs: 60_000,
    onChange,
  };

  const view = render(createElement(PlaybackHarness, props));
  const video = view.container.querySelector("video");

  if (!video) throw new Error("Expected the playback element");

  return {
    ...view,
    video,
    onChange,
    get playback() {
      const playback = onChange.mock.lastCall?.[0];

      if (!playback) throw new Error("Expected a committed playback hook");

      return playback;
    },
    changeRecording(recordingId: string) {
      view.rerender(
        createElement(PlaybackHarness, { ...props, recordingId, mediaUrl: `blob:${recordingId}` }),
      );
    },
  };
}

beforeEach(() => {
  TestResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());

  // jsdom has no media playback; emit browser events so the hook still observes the real contract.
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    Object.defineProperty(this, "paused", { configurable: true, value: false });
    this.dispatchEvent(new Event("play"));

    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    Object.defineProperty(this, "paused", { configurable: true, value: true });
    this.dispatchEvent(new Event("pause"));
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("recording playback lifecycle", () => {
  it("keeps controls synchronized with the video element and metadata", async () => {
    const view = mountPlayback();

    expect(view.playback.duration).toBe(60);

    act(() => view.playback.seek(12.5));

    expect(view.video.currentTime).toBe(12.5);
    expect(view.playback.currentTime).toBe(12.5);

    act(() => view.playback.cyclePlaybackRate());

    expect(view.video.playbackRate).toBe(1.5);
    expect(view.playback.playbackRate).toBe(1.5);

    await act(async () => view.playback.togglePlayback());

    expect(view.playback.playing).toBe(true);

    act(() => view.playback.togglePlayback());

    expect(view.playback.playing).toBe(false);

    Object.defineProperty(view.video, "duration", { configurable: true, value: 120 });
    fireEvent.loadedMetadata(view.video);

    expect(view.playback.duration).toBe(120);

    view.video.currentTime = 24;
    fireEvent.timeUpdate(view.video);

    expect(view.playback.currentTime).toBe(24);
  });

  it("resets when recordings change and ignores controls captured from the previous recording", () => {
    const view = mountPlayback();

    act(() => {
      view.playback.seek(25);
      view.playback.cyclePlaybackRate();
    });
    const oldPlayback = view.playback;

    view.changeRecording("recording-b");

    expect(view.playback.currentTime).toBe(0);
    expect(view.playback.playbackRate).toBe(1);
    expect(view.video.playbackRate).toBe(1);

    view.video.currentTime = 0;
    act(() => {
      oldPlayback.seek(40);
      oldPlayback.cyclePlaybackRate();
    });

    expect(view.playback.currentTime).toBe(0);
    expect(view.video.currentTime).toBe(0);
    expect(view.video.playbackRate).toBe(1);
    expect(TestResizeObserver.instances[0].disconnect).toHaveBeenCalledTimes(1);
  });

  it("measures contained media and releases observers, metadata listeners, and playback on disposal", () => {
    const view = mountPlayback();

    Object.defineProperties(view.video, {
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
      videoWidth: { configurable: true, value: 1920 },
      videoHeight: { configurable: true, value: 1080 },
    });
    fireEvent.loadedMetadata(view.video);

    expect(view.playback.videoContentRect).toEqual({ left: 0, top: 37.5, width: 400, height: 225 });

    const observer = TestResizeObserver.instances[0];
    const removeListener = vi.spyOn(view.video, "removeEventListener");

    view.unmount();
    const committedCount = view.onChange.mock.calls.length;

    act(() => observer.callback([], observer));

    expect(view.onChange).toHaveBeenCalledTimes(committedCount);
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledWith("loadedmetadata", expect.any(Function));
    expect(cancelAnimationFrame).toHaveBeenCalled();
    expect(view.video.pause).toHaveBeenCalled();
  });

  it("keeps stopped controls when the browser declines playback", async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValue(new Error("Playback blocked"));
    const view = mountPlayback();

    await act(async () => view.playback.togglePlayback());

    expect(view.playback.playing).toBe(false);
  });
});
