import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  needsClickActionAnalysis,
  type ClickEvent,
  type RecordingSummary,
  type TranscriptSegment,
} from "@path/shared";
import { activityKey, mergeTimeline } from "@path/timeline";
import {
  ACTIVITY_SCROLL_PAUSE_MS,
  displayedClickAction,
  PLAYBACK_SEEK_STEP_SECONDS,
} from "@/lib/ActivityPresentation";
import { getDesktopApi } from "@/lib/Desktop";
import { dispatchGuideImage, screenshotUrlToDataUrl } from "@/lib/GuideImageBus";
import { useRecordingHistory } from "../hooks/useRecordingHistory";
import { useRecordingMedia } from "../hooks/useRecordingMedia";
import { useRecordingPlayback } from "../hooks/useRecordingPlayback";
import { useRecordingActivity } from "../hooks/useRecordingActivity";
import type { TimelineImports } from "../hooks/useTimelineImports";
import { ActivityTimeline, type TimelineFilter } from "./ActivityTimeline";
import { ScreenshotHoverCard, ScreenshotViewer, screenshotHoverPosition } from "./ScreenshotViewer";
import { TimelineImportPanel } from "./TimelineImportPanel";
import { TimelineTabs, type TimelineTab } from "./TimelineTabs";
import { VideoStage } from "./VideoStage";

export function RecordingPane({
  recording,
  timelineTab,
  timelineImports,
  onTimelineTabChange,
  onNewRecording,
  onOpenSettings,
}: {
  recording: RecordingSummary | null;
  timelineTab: TimelineTab;
  timelineImports: TimelineImports;
  onTimelineTabChange(tab: TimelineTab): void;
  onNewRecording(): void;
  onOpenSettings(): void;
}) {
  const t = useTranslations();
  const recordingId = recording?.id ?? null;
  const recordingStatus = recording?.status ?? null;
  const { url: mediaUrl, status: mediaStatus } = useRecordingMedia(recordingId, recordingStatus);
  const playback = useRecordingPlayback({
    recordingId,
    mediaUrl,
    durationMs: recording?.durationMs ?? null,
  });

  const activity = useRecordingActivity({
    recordingId,
    status: recordingStatus,
    messages: {
      analysisFailed: t("recording.clickAnalysisFailed"),
      editFailed: t("recording.editFailed"),
      removeFailed: t("recording.removeFailed"),
      revealFailed: t("recording.revealScreenshotFailed"),
    },
  });

  const { refresh } = useRecordingHistory();
  const [showHotspots, setShowHotspots] = useState(true);
  const [openScreenshot, setOpenScreenshot] = useState<{ click: ClickEvent; url: string } | null>(
    null,
  );

  const [viewerError, setViewerError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [hoverScreenshot, setHoverScreenshot] = useState<{
    click: ClickEvent;
    url: string;
    top: number;
    left: number;
  } | null>(null);

  const [timelineQuery, setTimelineQuery] = useState("");
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>("all");
  const activityListRef = useRef<HTMLOListElement>(null);
  const isUserScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const allTimeline = mergeTimeline(activity.transcript, activity.clicks);
  const normalizedQuery = timelineQuery.trim().toLocaleLowerCase();
  const timeline = allTimeline.filter((entry) => {
    if (timelineFilter === "clicks" && entry.type !== "click") return false;
    if (timelineFilter === "speech" && entry.type !== "transcript") return false;
    if (!normalizedQuery) return true;

    const text =
      entry.type === "transcript" ? entry.segment.text : displayedClickAction(t, entry.click);

    return text.toLocaleLowerCase().includes(normalizedQuery);
  });

  const activePlaybackEntry = useMemo(() => {
    if (!playback.playing || timeline.length === 0) return null;

    const currentTimeMs = playback.currentTime * 1_000;
    const activeTranscript = timeline.find(
      (entry) =>
        entry.type === "transcript" &&
        currentTimeMs >= entry.segment.startMs &&
        currentTimeMs <= entry.segment.endMs,
    );

    if (activeTranscript) return activeTranscript;

    return [...timeline].reverse().find((entry) => entry.timestampMs <= currentTimeMs) ?? null;
  }, [playback.playing, playback.currentTime, timeline]);

  const activePlaybackKey = activePlaybackEntry ? activityKey(activePlaybackEntry) : null;
  const activeClick = activity.clicks
    .filter((click) => click.normalizedX !== null && click.normalizedY !== null)
    .map((click) => ({
      click,
      distance: Math.abs(click.timestampMs - playback.currentTime * 1_000),
    }))
    .sort((left, right) => left.distance - right.distance)[0];

  const canRetryAnalysis =
    recording?.status === "ready" &&
    !activity.analyzingClicks &&
    activity.clicks.some(
      (click) => click.screenshotPath && needsClickActionAnalysis(click.actionDescription),
    );

  useEffect(() => {
    if (!openScreenshot) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenScreenshot(null);
    }

    document.addEventListener("keydown", closeOnEscape);

    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [openScreenshot]);

  useEffect(() => {
    function handlePlaybackKeyDown(event: KeyboardEvent) {
      if (!recording || !mediaUrl || isTypingTarget(event.target)) return;

      if (event.code === "Space") {
        event.preventDefault();
        playback.togglePlayback();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        playback.seek(Math.max(0, playback.currentTime - PLAYBACK_SEEK_STEP_SECONDS));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        playback.seek(
          Math.min(playback.duration, playback.currentTime + PLAYBACK_SEEK_STEP_SECONDS),
        );
      }
    }

    window.addEventListener("keydown", handlePlaybackKeyDown);

    return () => window.removeEventListener("keydown", handlePlaybackKeyDown);
  }, [recording, mediaUrl, playback]);

  useEffect(() => {
    if (!playback.playing || !activePlaybackKey || isUserScrollingRef.current) return;

    activityListRef.current
      ?.querySelector<HTMLElement>(`[data-activity-id="${activePlaybackKey}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [playback.playing, activePlaybackKey]);

  useEffect(
    () => () => {
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    },
    [],
  );

  function pauseActivityScroll(): void {
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);

    scrollTimeoutRef.current = setTimeout(() => {
      isUserScrollingRef.current = false;
    }, ACTIVITY_SCROLL_PAUSE_MS);
  }

  function selectClick(click: ClickEvent): void {
    activity.selectActivity(activityKey({ type: "click", timestampMs: click.timestampMs, click }));
    playback.seek(click.timestampMs / 1_000);
  }

  function selectTranscript(segment: TranscriptSegment): void {
    activity.selectActivity(
      activityKey({ type: "transcript", timestampMs: segment.startMs, segment }),
    );
    playback.seek(segment.startMs / 1_000);
  }

  async function saveTranscript(
    segment: TranscriptSegment,
    nextText: string,
    editor: HTMLElement,
  ): Promise<void> {
    const text = nextText.trim();

    if (!text) {
      editor.textContent = segment.text;

      return;
    }

    if (text === segment.text) return;

    const result = await activity.saveTranscript(segment, text);

    if (result === "failed" && editor.isConnected) editor.textContent = segment.text;
  }

  async function saveClickDescription(
    click: ClickEvent,
    nextText: string,
    editor: HTMLElement,
  ): Promise<void> {
    const current = displayedClickAction(t, click);
    const text = nextText.replace(/\s+/g, " ").trim();

    if (!text) {
      editor.textContent = current;

      return;
    }

    if (text === current) return;

    const result = await activity.saveClickDescription(click, text);

    if (result === "failed" && editor.isConnected) editor.textContent = current;
  }

  async function removeClick(click: ClickEvent): Promise<void> {
    if (!(await activity.removeClick(click))) return;

    setOpenScreenshot((current) => (current?.click.id === click.id ? null : current));
    setHoverScreenshot((current) => (current?.click.id === click.id ? null : current));
  }

  async function retryProcessing(): Promise<void> {
    const desktop = getDesktopApi();

    if (!recording || !desktop || retrying) return;

    setRetrying(true);
    setRetryError(null);

    try {
      await desktop.recordings.retryProcessing({ id: recording.id });
      refresh();
    } catch (error) {
      setRetryError(
        error instanceof Error && error.message ? error.message : t("recording.retryFailed"),
      );
    } finally {
      setRetrying(false);
    }
  }

  async function insertScreenshotIntoGuide(click: ClickEvent, url: string): Promise<void> {
    setViewerError(null);

    try {
      dispatchGuideImage(await screenshotUrlToDataUrl(url), displayedClickAction(t, click));
    } catch {
      setViewerError(t("guide.imageInsertFailed"));
    }
  }

  let emptyVideoLabel = t("recording.emptyVideoTitle");

  if (recordingStatus === "recording" || recordingStatus === "processing") {
    emptyVideoLabel = t("recording.processing");
  }

  if (recordingStatus === "failed" || mediaStatus === "error") {
    emptyVideoLabel = t("recording.videoLoadFailed");
  }

  if (mediaStatus === "loading") emptyVideoLabel = t("recording.loadingVideo");

  let emptyTimelineLabel = t("recording.noTimeline");

  if (recording?.transcriptStatus === "failed") {
    emptyTimelineLabel = t("recording.transcriptFailed");
  }

  if (!recording) {
    emptyTimelineLabel = t("recording.selectPrompt");
  } else if (allTimeline.length > 0 && timeline.length === 0) {
    emptyTimelineLabel = t("recording.noFilteredActivity");
  }

  const timelineTabs = <TimelineTabs value={timelineTab} onChange={onTimelineTabChange} />;

  return (
    <main className="recording-panel">
      <VideoStage
        recordingId={recordingId}
        mediaUrl={mediaUrl}
        emptyLabel={emptyVideoLabel}
        failed={recordingStatus === "failed"}
        retrying={retrying}
        retryError={retryError}
        showHotspots={showHotspots}
        playing={playback.playing}
        currentTime={playback.currentTime}
        duration={playback.duration}
        playbackRate={playback.playbackRate}
        clicks={activity.clicks}
        activeClick={activeClick}
        videoRef={playback.videoRef}
        videoContentRect={playback.videoContentRect}
        onToggleHotspots={() => setShowHotspots((value) => !value)}
        onTogglePlayback={playback.togglePlayback}
        onPlayingChange={playback.setPlaying}
        onTimeUpdate={playback.setCurrentTime}
        onDurationChange={playback.setDuration}
        onSeek={playback.seek}
        onCyclePlaybackRate={playback.cyclePlaybackRate}
        onSelectClick={selectClick}
        onRetryProcessing={() => void retryProcessing()}
        onNewRecording={onNewRecording}
        onOpenSettings={onOpenSettings}
      />
      {timelineTab === "activity" ? (
        <ActivityTimeline
          tabs={timelineTabs}
          recordingSelected={Boolean(recording)}
          timeline={timeline}
          allCount={allTimeline.length}
          clickCount={activity.clicks.length}
          speechCount={activity.transcript.length}
          filter={timelineFilter}
          query={timelineQuery}
          selectedActivityKey={activity.selectedActivityKey}
          activePlaybackKey={activePlaybackKey}
          playing={playback.playing}
          pendingIds={activity.pendingIds}
          analyzingClicks={activity.analyzingClicks}
          error={activity.error}
          emptyLabel={emptyTimelineLabel}
          canRetryAnalysis={canRetryAnalysis}
          listRef={activityListRef}
          onScrollPause={pauseActivityScroll}
          onFilterChange={setTimelineFilter}
          onQueryChange={setTimelineQuery}
          onRetryAnalysis={() => void activity.retryAnalysis()}
          onSelectClick={selectClick}
          onSelectTranscript={selectTranscript}
          onFocusActivity={activity.selectActivity}
          onSaveClickDescription={(click, text, editor) =>
            void saveClickDescription(click, text, editor)
          }
          onSaveTranscript={(segment, text, editor) => void saveTranscript(segment, text, editor)}
          onRemoveClick={(click) => void removeClick(click)}
          onRemoveTranscript={(segment) => void activity.removeTranscript(segment)}
          onOpenScreenshot={(click, url) => {
            setViewerError(null);
            setOpenScreenshot({ click, url });
          }}
          onInsertScreenshot={(click, url) => void insertScreenshotIntoGuide(click, url)}
          onPreviewScreenshot={(click, url, anchor) =>
            setHoverScreenshot({ click, url, ...screenshotHoverPosition(anchor) })
          }
          onPreviewEnd={() => setHoverScreenshot(null)}
          onUserScrollChange={(scrolling) => {
            isUserScrollingRef.current = scrolling;
          }}
        />
      ) : (
        <TimelineImportPanel
          // Search, selection, and scroll position belong to one recording's tab.
          key={`${recordingId ?? "none"}-${timelineTab}`}
          tabs={timelineTabs}
          kind={timelineTab}
          recordingId={recordingId}
          recordingSelected={Boolean(recording)}
          timeWindow={timelineImports.window}
          timelineImport={timelineImports.imports[timelineTab]}
          isLoading={timelineImports.isLoading}
          isBusy={timelineImports.busyKind === timelineTab}
          error={timelineImports.errors[timelineTab]}
          currentTimeMs={playback.currentTime * 1_000}
          playing={playback.playing}
          onImport={() => void timelineImports.importFile(timelineTab)}
          onOffsetChange={(offsetMs) => void timelineImports.updateOffset(timelineTab, offsetMs)}
          onRemove={() => void timelineImports.removeImport(timelineTab)}
          onSeek={(timestampMs) => playback.seek(timestampMs / 1_000)}
        />
      )}
      {hoverScreenshot && <ScreenshotHoverCard {...hoverScreenshot} showHotspot={showHotspots} />}
      {openScreenshot && (
        <ScreenshotViewer
          click={openScreenshot.click}
          url={openScreenshot.url}
          showHotspot={showHotspots}
          error={viewerError}
          onInsert={() =>
            void insertScreenshotIntoGuide(openScreenshot.click, openScreenshot.url).then(() =>
              setOpenScreenshot(null),
            )
          }
          onReveal={() => void activity.revealScreenshot(openScreenshot.click)}
          onClose={() => setOpenScreenshot(null)}
        />
      )}
    </main>
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT" ||
      Boolean(target.closest("button")) ||
      Boolean(target.closest("[contenteditable='true']")))
  );
}
