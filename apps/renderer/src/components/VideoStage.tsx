import type { CSSProperties, RefObject } from "react";
import { FileVideo2, Gauge, Pause, Play, Plus, RotateCcw, Settings } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ClickEvent } from "@path/shared";
import type { ContainedMediaRect } from "@/lib/ContainedMedia";
import { formatPlayerTime } from "@/lib/Format";
import { CLICK_HOTSPOT_WINDOW_MS, clickLabel } from "@/lib/ActivityPresentation";
import { cn } from "@/lib/ClassNames";
import { useAiModels } from "../hooks/useAiModels";
import { Button } from "./Button";

export function VideoStage({
  recordingId,
  mediaUrl,
  emptyLabel,
  failed,
  retrying,
  retryError,
  showHotspots,
  playing,
  currentTime,
  duration,
  playbackRate,
  clicks,
  activeClick,
  videoRef,
  videoContentRect,
  onToggleHotspots,
  onTogglePlayback,
  onPlayingChange,
  onTimeUpdate,
  onDurationChange,
  onSeek,
  onCyclePlaybackRate,
  onSelectClick,
  onRetryProcessing,
  onNewRecording,
  onOpenSettings,
}: {
  recordingId: string | null;
  mediaUrl: string | null;
  emptyLabel: string;
  failed: boolean;
  retrying: boolean;
  retryError: string | null;
  showHotspots: boolean;
  playing: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  clicks: ClickEvent[];
  activeClick: { click: ClickEvent; distance: number } | undefined;
  videoRef: RefObject<HTMLVideoElement | null>;
  videoContentRect: ContainedMediaRect | null;
  onToggleHotspots(): void;
  onTogglePlayback(): void;
  onPlayingChange(playing: boolean): void;
  onTimeUpdate(time: number): void;
  onDurationChange(duration: number): void;
  onSeek(time: number): void;
  onCyclePlaybackRate(): void;
  onSelectClick(click: ClickEvent): void;
  onRetryProcessing(): void;
  onNewRecording(): void;
  onOpenSettings(): void;
}) {
  const t = useTranslations();
  const ready = Boolean(recordingId && mediaUrl);
  const progress = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  const hotspot =
    showHotspots &&
    activeClick &&
    activeClick.distance <= CLICK_HOTSPOT_WINDOW_MS &&
    activeClick.click.normalizedX !== null &&
    activeClick.click.normalizedY !== null &&
    videoContentRect
      ? activeClick
      : null;

  return (
    <>
      <header className="recording-capture-header">
        <span className="section-label">{t("recording.title")}</span>
        {ready && (
          <button
            type="button"
            className="hotspot-toggle"
            aria-pressed={showHotspots}
            onClick={onToggleHotspots}
          >
            {t("recording.hotspots")}
            <span className={showHotspots ? "on" : ""} aria-hidden="true" />
          </button>
        )}
      </header>
      <section className={cn("video-stage", ready && "video-stage-ready")}>
        {ready ? (
          <>
            <div className="video-viewport">
              <video
                ref={videoRef}
                src={mediaUrl ?? undefined}
                data-recording-id={recordingId ?? undefined}
                onClick={onTogglePlayback}
                onPlay={() => onPlayingChange(true)}
                onPause={() => onPlayingChange(false)}
                onTimeUpdate={(event) => onTimeUpdate(event.currentTarget.currentTime)}
                onLoadedMetadata={(event) => onDurationChange(event.currentTarget.duration)}
              />
              {hotspot && videoContentRect && (
                <span
                  className="video-click-hotspot"
                  style={{
                    left:
                      videoContentRect.left + hotspot.click.normalizedX! * videoContentRect.width,
                    top:
                      videoContentRect.top + hotspot.click.normalizedY! * videoContentRect.height,
                  }}
                />
              )}
            </div>
            <div className="video-controls">
              <button
                type="button"
                className="video-play-toggle"
                title={t(playing ? "recording.pause" : "recording.play")}
                onClick={onTogglePlayback}
              >
                {playing ? (
                  <Pause size={18} aria-hidden="true" />
                ) : (
                  <Play size={18} aria-hidden="true" />
                )}
              </button>
              <div className="video-time">
                <span className="video-current-time">{formatPlayerTime(currentTime)}</span>
                <span className="video-time-divider">/</span>
                <span className="video-duration">{formatPlayerTime(duration)}</span>
              </div>
              <div
                className="video-scrubber"
                style={{ "--playback-progress": `${progress}%` } as CSSProperties}
              >
                <input
                  type="range"
                  min={0}
                  max={Math.max(duration, 0.01)}
                  step={0.05}
                  value={Math.min(currentTime, duration || 0)}
                  onChange={(event) => onSeek(Number(event.target.value))}
                  aria-label={t("recording.title")}
                  aria-valuetext={`${formatPlayerTime(currentTime)} / ${formatPlayerTime(duration)}`}
                />
                <div className="timeline-click-markers">
                  {clicks.map((click) => (
                    <button
                      type="button"
                      key={click.id}
                      style={{
                        left: `${Math.min(100, (click.timestampMs / Math.max(1, duration * 1_000)) * 100)}%`,
                      }}
                      title={`${clickLabel(t, click.button)} · ${formatPlayerTime(click.timestampMs / 1_000)}`}
                      onClick={() => onSelectClick(click)}
                    />
                  ))}
                </div>
              </div>
              <button
                type="button"
                className="video-speed-toggle"
                title={t("recording.speedHint")}
                aria-label={t("recording.speedValue", { rate: playbackRate })}
                onClick={onCyclePlaybackRate}
              >
                <Gauge size={14} aria-hidden="true" />
                <span>{playbackRate}×</span>
              </button>
            </div>
          </>
        ) : !recordingId ? (
          <OnboardingEmptyState onNewRecording={onNewRecording} onOpenSettings={onOpenSettings} />
        ) : (
          <div className="video-empty-state">
            <div className="video-empty-visual">
              <span />
              <FileVideo2 aria-hidden="true" size={24} />
            </div>
            <div className="video-empty-copy">
              <strong>{emptyLabel}</strong>
              {failed && (
                <>
                  <div className="onboarding-actions">
                    <Button size="sm" disabled={retrying} onClick={onRetryProcessing}>
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
    </>
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
  const { models, keyStatus, isLoading } = useAiModels();
  const availableModels = [
    ...models.local,
    ...models.api.filter((model) => keyStatus[model.provider]),
  ];

  const hasModels = (["visual", "text"] as const).every((purpose) =>
    availableModels.some((model) => model.supportedPurposes.includes(purpose)),
  );

  return (
    <div className="video-empty-state">
      <div className="video-empty-visual">
        <span />
        <FileVideo2 aria-hidden="true" size={24} />
      </div>
      <div className="video-empty-copy">
        <strong>{t("recording.onboardingTitle")}</strong>
        <div className="onboarding-actions">
          <Button size="sm" onClick={onNewRecording}>
            <Plus size={14} />
            {t("recording.newRecording")}
          </Button>
        </div>
        {!isLoading && !hasModels && (
          <div className="onboarding-warning">
            <Settings aria-hidden="true" size={14} />
            <span className="onboarding-model-missing">
              <span>{t("recording.onboardingNeedsModel")}</span>
              <button type="button" onClick={onOpenSettings}>
                {t("recording.configureKeys")}
              </button>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
