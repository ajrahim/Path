import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { containedMediaRect, type ContainedMediaRect } from "@/lib/ContainedMedia";

interface PlaybackState {
  playing: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
}

interface PlaybackSource {
  recordingId: string | null;
  mediaUrl: string | null;
}

interface PlaybackSnapshot {
  source: PlaybackSource;
  state: PlaybackState;
}

interface RecordingPlayback extends PlaybackState {
  videoRef: RefObject<HTMLVideoElement | null>;
  videoContentRect: ContainedMediaRect | null;
  setPlaying(playing: boolean): void;
  setCurrentTime(time: number): void;
  setDuration(duration: number): void;
  seek(time: number): void;
  togglePlayback(): void;
  cyclePlaybackRate(): void;
}

/** Owns the video element, transport state, and contained-media geometry for the current source. */
export function useRecordingPlayback({
  recordingId,
  mediaUrl,
  durationMs,
}: PlaybackSource & { durationMs: number | null }): RecordingPlayback {
  const videoRef = useRef<HTMLVideoElement>(null);
  const activeSourceRef = useRef<PlaybackSource | null>(null);
  const [snapshot, setSnapshot] = useState<PlaybackSnapshot | null>(null);
  const [layout, setLayout] = useState<{ source: PlaybackSource; rect: ContainedMediaRect } | null>(
    null,
  );

  const source = useMemo(() => ({ recordingId, mediaUrl }), [recordingId, mediaUrl]);
  const initialState: PlaybackState = {
    playing: false,
    currentTime: 0,
    duration: durationMs ? durationMs / 1_000 : 0,
    playbackRate: 1,
  };

  const state = snapshot?.source === source ? snapshot.state : initialState;

  function updateState(update: Partial<PlaybackState>): void {
    // A callback captured by the previous source must not control its replacement.
    if (activeSourceRef.current !== source) return;

    setSnapshot((current) => ({
      source,
      state: { ...(current?.source === source ? current.state : initialState), ...update },
    }));
  }

  useEffect(() => {
    activeSourceRef.current = source;
    const video = videoRef.current;

    if (!video || !source.mediaUrl) {
      return () => {
        if (activeSourceRef.current === source) activeSourceRef.current = null;
      };
    }

    const measuredVideo: HTMLVideoElement = video;
    let active = true;

    video.playbackRate = 1;

    function updateLayout(): void {
      if (!active) return;

      const rect = containedMediaRect(
        { width: measuredVideo.clientWidth, height: measuredVideo.clientHeight },
        { width: measuredVideo.videoWidth, height: measuredVideo.videoHeight },
      );

      if (rect) setLayout({ source, rect });
    }

    const observer = new ResizeObserver(updateLayout);
    const frame = requestAnimationFrame(updateLayout);

    observer.observe(video);
    video.addEventListener("loadedmetadata", updateLayout);

    return () => {
      active = false;
      if (activeSourceRef.current === source) activeSourceRef.current = null;

      cancelAnimationFrame(frame);
      observer.disconnect();
      video.removeEventListener("loadedmetadata", updateLayout);
      video.pause();
    };
  }, [source]);

  function seek(time: number): void {
    if (activeSourceRef.current !== source) return;

    if (videoRef.current) videoRef.current.currentTime = time;

    updateState({ currentTime: time });
  }

  function togglePlayback(): void {
    if (activeSourceRef.current !== source) return;

    const video = videoRef.current;

    if (!video) return;

    if (video.paused) {
      // A browser may deny play; the UI follows the actual play/pause events.
      void video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }

  function cyclePlaybackRate(): void {
    if (activeSourceRef.current !== source) return;

    const rates = [0.5, 1, 1.5, 2];
    const nextRate = rates[(rates.indexOf(state.playbackRate) + 1) % rates.length] ?? 1;

    updateState({ playbackRate: nextRate });
    if (videoRef.current) videoRef.current.playbackRate = nextRate;
  }

  return {
    ...state,
    videoRef,
    videoContentRect: layout?.source === source ? layout.rect : null,
    setPlaying: (playing) => updateState({ playing }),
    setCurrentTime: (currentTime) => updateState({ currentTime }),
    setDuration: (duration) => updateState({ duration }),
    seek,
    togglePlayback,
    cyclePlaybackRate,
  };
}
