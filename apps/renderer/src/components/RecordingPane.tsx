import { useEffect, useState } from "react";
import {
  Captions,
  Check,
  FileVideo2,
  FolderOpen,
  Gauge,
  ImagePlus,
  Mic,
  MousePointer2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { ClickEvent, RecordingSummary, TranscriptSegment } from "@path/shared";
import { mergeTimeline } from "@path/timeline";
import { formatClickTimestamp, formatPlayerTime } from "@/lib/Format";
import { getDesktopApi } from "@/lib/Desktop";
import { dispatchGuideImage, screenshotUrlToDataUrl } from "@/lib/GuideImageBus";
import { Button } from "./Button";
import { ScreenshotAction } from "./ScreenshotAction";
import { ScreenshotImage } from "./ScreenshotImage";
import { cn } from "@/lib/ClassNames";
import { useAiModels } from "../hooks/useAiModels";
import { useRecordingHistory } from "../hooks/useRecordingHistory";
import { useRecordingMedia } from "../hooks/useRecordingMedia";
import { useRecordingPlayback } from "../hooks/useRecordingPlayback";
import { useRecordingActivity } from "../hooks/useRecordingActivity";

export function RecordingPane({
  recording,
  onNewRecording,
  onOpenSettings,
}: {
  recording: RecordingSummary | null;
  onNewRecording(): void;
  onOpenSettings(): void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const recordingId = recording?.id ?? null;
  const recordingStatus = recording?.status ?? null;

  // Hooks own resources and pending work; this view owns the visible timeline and overlays.
  const { url: mediaUrl, status: mediaStatus } = useRecordingMedia(recordingId, recordingStatus);
  const {
    videoRef,
    playing,
    currentTime,
    duration,
    playbackRate,
    videoContentRect,
    setPlaying,
    setCurrentTime,
    setDuration,
    seek,
    togglePlayback,
    cyclePlaybackRate,
  } = useRecordingPlayback({ recordingId, mediaUrl, durationMs: recording?.durationMs ?? null });

  const {
    clicks,
    transcript,
    selectedActivityKey,
    pendingIds: activityPendingIds,
    error: activityError,
    analyzingClicks,
    selectActivity: setSelectedActivityKey,
    saveTranscript: updateTranscript,
    saveClickDescription: updateClickDescription,
    removeTranscript,
    removeClick: deleteClick,
    revealScreenshot,
    retryAnalysis,
  } = useRecordingActivity({
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

  if (!recording) emptyTimelineLabel = t("recording.selectPrompt");

  useEffect(() => {
    if (!openScreenshot) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenScreenshot(null);
    }

    document.addEventListener("keydown", closeOnEscape);

    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [openScreenshot]);

  const activeClick = clicks
    .filter((click) => click.normalizedX !== null && click.normalizedY !== null)
    .map((click) => ({ click, distance: Math.abs(click.timestampMs - currentTime * 1_000) }))
    .sort((left, right) => left.distance - right.distance)[0];

  const normalizedQuery = timelineQuery.trim().toLocaleLowerCase();
  const timeline = mergeTimeline(transcript, clicks).filter((entry) =>
    entry.type === "transcript"
      ? entry.segment.text.toLocaleLowerCase().includes(normalizedQuery)
      : `${clickLabel(t, entry.click)} ${clickActionDescription(t, entry.click) ?? ""}`
          .toLocaleLowerCase()
          .includes(normalizedQuery),
  );

  const canRetryAnalysis =
    recording?.status === "ready" &&
    !analyzingClicks &&
    clicks.some((click) => click.screenshotPath && !click.actionDescription?.trim());

  function selectClick(click: ClickEvent): void {
    setSelectedActivityKey(`click-${click.id}`);
    const time = click.timestampMs / 1_000;

    seek(time);
  }

  function selectTranscript(segment: TranscriptSegment): void {
    setSelectedActivityKey(`transcript-${segment.id}`);
    const time = segment.startMs / 1_000;

    seek(time);
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

    const result = await updateTranscript(segment, text);

    // A failed edit may complete after the user has switched away from this editor.
    if (result === "failed" && editor.isConnected) editor.textContent = segment.text;
  }

  async function saveClickDescription(
    click: ClickEvent,
    nextText: string,
    editor: HTMLElement,
  ): Promise<void> {
    const current = clickActionDescription(t, click) ?? clickLabel(t, click);
    const text = nextText.replace(/\s+/g, " ").trim();

    if (!text) {
      editor.textContent = current;

      return;
    }

    if (text === current) return;

    const result = await updateClickDescription(click, text);

    // A failed edit may complete after the user has switched away from this editor.
    if (result === "failed" && editor.isConnected) editor.textContent = current;
  }

  async function removeClick(click: ClickEvent): Promise<void> {
    if (!(await deleteClick(click))) return;

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

  async function insertViewerScreenshot(): Promise<void> {
    if (!openScreenshot) return;

    setViewerError(null);

    try {
      const dataUrl = await screenshotUrlToDataUrl(openScreenshot.url);

      dispatchGuideImage(
        dataUrl,
        clickActionDescription(t, openScreenshot.click) ?? clickLabel(t, openScreenshot.click),
      );
      setOpenScreenshot(null);
    } catch {
      setViewerError(t("guide.imageInsertFailed"));
    }
  }

  return (
    <main className="recording-panel">
      <section className={cn("video-stage", recording && mediaUrl && "video-stage-ready")}>
        {recording && mediaUrl ? (
          <>
            <div className="video-viewport">
              <video
                ref={videoRef}
                src={mediaUrl}
                data-recording-id={recording.id}
                onClick={togglePlayback}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
              />
              {showHotspots &&
                activeClick &&
                activeClick.distance <= 600 &&
                activeClick.click.normalizedX !== null &&
                activeClick.click.normalizedY !== null &&
                videoContentRect && (
                  <span
                    className="video-click-hotspot"
                    style={{
                      left:
                        videoContentRect.left +
                        activeClick.click.normalizedX * videoContentRect.width,
                      top:
                        videoContentRect.top +
                        activeClick.click.normalizedY * videoContentRect.height,
                    }}
                  />
                )}
              <button className="hotspot-toggle" onClick={() => setShowHotspots((value) => !value)}>
                {t("recording.hotspots")}
                <span className={showHotspots ? "on" : ""} />
              </button>
            </div>
            <div className="video-controls">
              <button
                title={t(playing ? "recording.pause" : "recording.play")}
                onClick={togglePlayback}
              >
                {playing ? <Pause size={17} /> : <Play size={17} />}
              </button>
              <span>
                {formatPlayerTime(currentTime)} / {formatPlayerTime(duration)}
              </span>
              <div className="video-scrubber">
                <input
                  type="range"
                  min={0}
                  max={Math.max(duration, 0.01)}
                  step={0.05}
                  value={Math.min(currentTime, duration || 0)}
                  onChange={(event) => {
                    const time = Number(event.target.value);

                    seek(time);
                  }}
                  aria-label={t("recording.title")}
                />
                <div className="timeline-click-markers">
                  {clicks.map((click) => (
                    <button
                      key={click.id}
                      style={{
                        left: `${Math.min(100, (click.timestampMs / Math.max(1, duration * 1_000)) * 100)}%`,
                      }}
                      title={`${clickLabel(t, click)} · ${formatPlayerTime(click.timestampMs / 1_000)}`}
                      onClick={() => selectClick(click)}
                    />
                  ))}
                </div>
              </div>
              <button title={t("recording.speed")} onClick={cyclePlaybackRate}>
                <Gauge size={15} />
                {playbackRate}x
              </button>
            </div>
          </>
        ) : !recording ? (
          <OnboardingEmptyState onNewRecording={onNewRecording} onOpenSettings={onOpenSettings} />
        ) : (
          <div className="video-empty-state">
            <div className="video-empty-visual">
              <span />
              <FileVideo2 aria-hidden="true" size={24} />
            </div>
            <div className="video-empty-copy">
              <strong>{emptyVideoLabel}</strong>
              {recordingStatus === "failed" && (
                <>
                  <div className="onboarding-actions">
                    <Button size="sm" disabled={retrying} onClick={() => void retryProcessing()}>
                      <RotateCcw size={14} />
                      {retrying ? t("recording.processing") : t("recording.retryProcessing")}
                    </Button>
                  </div>
                  {retryError && (
                    <p className="video-empty-error" role="alert">
                      {retryError}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </section>
      <section className="transcript-panel">
        <header>
          <div className="activity-heading">
            <span className="section-label">{t("recording.activity")}</span>
            <span>
              {analyzingClicks
                ? t("recording.analyzingClicks")
                : t("recording.activityCount", { count: timeline.length })}
            </span>
            {canRetryAnalysis && (
              <button type="button" className="activity-retry" onClick={() => void retryAnalysis()}>
                <RotateCcw size={13} />
                {t("recording.retryAnalysis")}
              </button>
            )}
          </div>
          <label className="transcript-search">
            <Search size={14} />
            <input
              value={timelineQuery}
              onChange={(event) => setTimelineQuery(event.target.value)}
              placeholder={t("recording.searchTranscript")}
              aria-label={t("recording.searchTranscript")}
            />
          </label>
        </header>
        {activityError && (
          <p className="activity-error" role="alert">
            {activityError}
          </p>
        )}
        {recording && timeline.length > 0 ? (
          <ol className="activity-cards" aria-label={t("recording.activity")}>
            {timeline.map((entry) =>
              entry.type === "click" ? (
                <li
                  className={
                    `click-${entry.click.id}` === selectedActivityKey
                      ? "activity-entry activity-entry-click selected"
                      : "activity-entry activity-entry-click"
                  }
                  key={`click-${entry.click.id}`}
                  data-timestamp-ms={entry.timestampMs}
                >
                  <button
                    className="activity-entry-main"
                    aria-pressed={`click-${entry.click.id}` === selectedActivityKey}
                    onClick={() => selectClick(entry.click)}
                  >
                    <span
                      className="activity-time"
                      title={formatClickTimestamp(
                        entry.click.createdAt,
                        entry.click.timestampMs,
                        locale,
                      )}
                    >
                      {formatPlayerTime(entry.click.timestampMs / 1_000)}
                    </span>
                    <span className="activity-icon activity-icon-click">
                      <MousePointer2 size={17} />
                    </span>
                    <span className="activity-copy">
                      <span
                        className="activity-click-editor"
                        contentEditable
                        suppressContentEditableWarning
                        role="textbox"
                        aria-multiline="false"
                        aria-label={t("recording.editClickDescription")}
                        onFocus={() => setSelectedActivityKey(`click-${entry.click.id}`)}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            event.currentTarget.blur();
                          }

                          if (event.key === "Escape") {
                            event.currentTarget.textContent =
                              clickActionDescription(t, entry.click) ?? clickLabel(t, entry.click);
                            event.currentTarget.blur();
                          }
                        }}
                        onBlur={(event) =>
                          void saveClickDescription(
                            entry.click,
                            event.currentTarget.innerText,
                            event.currentTarget,
                          )
                        }
                      >
                        {clickActionDescription(t, entry.click) ?? clickLabel(t, entry.click)}
                      </span>
                      {entry.click.actionDescription && <small>{clickLabel(t, entry.click)}</small>}
                    </span>
                  </button>
                  {entry.click.screenshotPath && (
                    <ScreenshotAction
                      click={entry.click}
                      onOpen={(url) => {
                        selectClick(entry.click);
                        setViewerError(null);
                        setOpenScreenshot({ click: entry.click, url });
                      }}
                      onPreview={(url, anchor) => {
                        const width = 260;
                        const height = 174;

                        setHoverScreenshot({
                          click: entry.click,
                          url,
                          top:
                            anchor.top > height + 12 ? anchor.top - height - 8 : anchor.bottom + 8,
                          left: Math.max(
                            12,
                            Math.min(anchor.right - width, window.innerWidth - width - 12),
                          ),
                        });
                      }}
                      onPreviewEnd={() => setHoverScreenshot(null)}
                    />
                  )}
                  <button
                    type="button"
                    className="activity-row-action activity-remove-action"
                    title={t("recording.removeClick")}
                    aria-label={t("recording.removeClick")}
                    disabled={activityPendingIds.includes(entry.click.id)}
                    onClick={() => void removeClick(entry.click)}
                  >
                    <Trash2 size={16} />
                  </button>
                </li>
              ) : (
                <li
                  key={`transcript-${entry.segment.id}`}
                  data-timestamp-ms={entry.timestampMs}
                  className={
                    `transcript-${entry.segment.id}` === selectedActivityKey
                      ? "activity-entry transcript-entry selected"
                      : "activity-entry transcript-entry"
                  }
                >
                  <div
                    className="activity-entry-main transcript-entry-main"
                    onClick={() => selectTranscript(entry.segment)}
                  >
                    <button
                      type="button"
                      className="activity-time activity-time-range"
                      aria-pressed={`transcript-${entry.segment.id}` === selectedActivityKey}
                      aria-label={`${t("recording.transcriptActivity")} ${formatActivityRange(entry.segment)}`}
                    >
                      {formatActivityRange(entry.segment)}
                    </button>
                    <span className="activity-icon activity-icon-transcript">
                      <Captions size={17} />
                    </span>
                    <span className="activity-copy">
                      <span
                        className="activity-dialogue-editor"
                        contentEditable
                        suppressContentEditableWarning
                        role="textbox"
                        aria-multiline="true"
                        aria-label={t("recording.editDialogue")}
                        onFocus={() => setSelectedActivityKey(`transcript-${entry.segment.id}`)}
                        onClick={(event) => event.stopPropagation()}
                        onBlur={(event) =>
                          void saveTranscript(
                            entry.segment,
                            event.currentTarget.innerText,
                            event.currentTarget,
                          )
                        }
                      >
                        {entry.segment.text}
                      </span>
                    </span>
                  </div>
                  <button
                    type="button"
                    className="activity-row-action activity-remove-action"
                    title={t("recording.removeDialogue")}
                    aria-label={t("recording.removeDialogue")}
                    disabled={activityPendingIds.includes(entry.segment.id)}
                    onClick={() => void removeTranscript(entry.segment)}
                  >
                    <Trash2 size={16} />
                  </button>
                </li>
              ),
            )}
          </ol>
        ) : (
          <div className="transcript-empty">
            <MousePointer2 aria-hidden="true" size={18} />
            <span>{emptyTimelineLabel}</span>
          </div>
        )}
      </section>
      {hoverScreenshot && (
        <div
          className="screenshot-hover-card"
          style={{ top: hoverScreenshot.top, left: hoverScreenshot.left }}
        >
          <ScreenshotImage
            click={hoverScreenshot.click}
            url={hoverScreenshot.url}
            showHotspot={showHotspots}
          />
        </div>
      )}
      {openScreenshot && (
        <div
          className="modal-backdrop screenshot-viewer-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpenScreenshot(null);
          }}
        >
          <div
            className="screenshot-viewer"
            role="dialog"
            aria-modal="true"
            aria-label={t("recording.screenshotViewer")}
          >
            <header>
              <div>
                <strong>{clickLabel(t, openScreenshot.click)}</strong>
                <span>{formatPlayerTime(openScreenshot.click.timestampMs / 1_000)}</span>
              </div>
              <div className="screenshot-viewer-actions">
                <button
                  className="screenshot-reveal-button"
                  type="button"
                  onClick={() => void insertViewerScreenshot()}
                >
                  <ImagePlus size={15} />
                  <span>{t("guide.insertScreenshot")}</span>
                </button>
                <button
                  className="screenshot-reveal-button"
                  type="button"
                  onClick={() => void revealScreenshot(openScreenshot.click)}
                >
                  <FolderOpen size={15} />
                  <span>{t("recording.revealScreenshot")}</span>
                </button>
                <button
                  type="button"
                  title={t("recording.closeScreenshot")}
                  onClick={() => setOpenScreenshot(null)}
                >
                  <X size={18} />
                </button>
              </div>
            </header>
            <ScreenshotImage
              click={openScreenshot.click}
              url={openScreenshot.url}
              showHotspot={showHotspots}
            />
            {viewerError && (
              <p className="screenshot-viewer-error" role="alert">
                {viewerError}
              </p>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

function OnboardingEmptyState({
  onNewRecording,
  onOpenSettings,
}: {
  onNewRecording(): void;
  onOpenSettings(): void;
}) {
  const t = useTranslations();
  const { models, selection, isLoading } = useAiModels();
  const hasModels = models.api.length > 0 || models.local.length > 0;

  return (
    <div className="video-empty-state">
      <div className="video-empty-visual">
        <span />
        <FileVideo2 aria-hidden="true" size={24} />
      </div>
      <div className="video-empty-copy">
        <strong>{t("recording.onboardingTitle")}</strong>
        <p>{t("recording.onboardingDescription")}</p>
        <div className="onboarding-actions">
          <Button size="sm" onClick={onNewRecording}>
            <Plus size={14} />
            {t("recording.newRecording")}
          </Button>
        </div>
        <ul className="onboarding-checklist">
          <li>
            <Mic aria-hidden="true" size={14} />
            <span>{t("recording.onboardingMic")}</span>
          </li>
          <li>
            {isLoading ? (
              <Gauge aria-hidden="true" size={14} />
            ) : hasModels ? (
              <Check aria-hidden="true" size={14} />
            ) : (
              <Settings aria-hidden="true" size={14} />
            )}
            {isLoading ? (
              <span>{t("navigation.checkingAiModels")}</span>
            ) : hasModels ? (
              <span>
                {t("recording.onboardingReady")}: {selection?.modelName ?? t("navigation.aiModel")}
              </span>
            ) : (
              <span className="onboarding-model-missing">
                <span>{t("recording.onboardingNeedsModel")}</span>
                <button type="button" onClick={onOpenSettings}>
                  {t("recording.configureKeys")}
                </button>
              </span>
            )}
          </li>
        </ul>
      </div>
    </div>
  );
}

function clickLabel(t: ReturnType<typeof useTranslations>, click: ClickEvent): string {
  if (click.button === "right") return t("recording.rightClick");

  if (click.button === "middle") return t("recording.middleClick");

  return t("recording.leftClick");
}

function clickActionDescription(
  t: ReturnType<typeof useTranslations>,
  click: ClickEvent,
): string | null {
  const description = click.actionDescription?.trim();

  if (!description) return null;

  if (description === "Unknown control") return t("recording.unknownControl");

  const isNonAnswer =
    /\b(?:cannot|can't|unable|no screenshot|need (?:the|a) screenshot|screenshot (?:was not|is not|isn't|were not)|image (?:was not|is not|isn't)|not provided|unavailable|lack access|identify the ui control)\b/i.test(
      description,
    );

  if (isNonAnswer || description.length > 180 || description.split(/\s+/).length > 24) {
    return t("recording.unknownControl");
  }

  if (description.split(/\s+/).length <= 6 && !/^the user\b/i.test(description)) {
    const verb =
      click.button === "right"
        ? "right-clicks"
        : click.button === "middle"
          ? "middle-clicks"
          : "clicks";

    return `The user ${verb} the ${description.replace(/[.!]+$/, "")}.`;
  }

  return description;
}

function formatActivityRange(segment: TranscriptSegment): string {
  return `${formatPlayerTime(segment.startMs / 1_000)} - ${formatPlayerTime(segment.endMs / 1_000)}`;
}
