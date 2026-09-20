import { useEffect, useState } from "react";
import Image from "next/image";
import { AppWindow, Check, Crop, Mic, Monitor, MousePointer2, ScreenShare, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { CaptureMode, CaptureSource } from "@path/shared";
import { Button } from "@/components/Button";
import { formatDefaultRecordingTitle } from "@/lib/Format";
import { getDesktopApi } from "@/lib/Desktop";
import { cn } from "@/lib/ClassNames";
import { useRecording } from "../hooks/useRecording";

type SourceMode = "full-screen" | CaptureMode;

interface SourceDialogProps {
  open: boolean;
  onClose(): void;
  onStarted(recordingId: string | null): void;
}

const modeIcons = { "full-screen": ScreenShare, display: Monitor, window: AppWindow, region: Crop };

export function SourceDialog({ open, onClose, onStarted }: SourceDialogProps) {
  const t = useTranslations("recording");
  const locale = useLocale();
  const actions = useTranslations("actions");
  const { snapshot, loadSources, start: startCapture } = useRecording();
  const [mode, setMode] = useState<SourceMode>("full-screen");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [includeMicrophone, setIncludeMicrophone] = useState(false);
  const [captureClicks, setCaptureClicks] = useState(true);
  const [defaultTitle] = useState(() => formatDefaultRecordingTitle(new Date(), locale));
  const [title, setTitle] = useState(defaultTitle);

  useEffect(() => {
    if (!open) return;

    const request = loadSources();

    return () => request.abort();
  }, [open, loadSources]);

  if (!open) return null;

  const sourceType = mode === "window" ? "window" : "screen";
  const availableSources = snapshot.sources.filter((source) => source.type === sourceType);
  const selected =
    availableSources.find((source) => source.id === selectedId) ?? availableSources[0] ?? null;

  async function start(): Promise<void> {
    if (!selected) return;

    let captureRegion;

    if (mode === "region") {
      if (!selected.displayId) return;

      captureRegion = await getDesktopApi()?.recording.selectRegion({
        sourceId: selected.id,
        displayId: selected.displayId,
      });

      // Dismissing the native region chooser cancels this start attempt.
      if (!captureRegion) return;
    }

    const state = await startCapture({
      sourceId: selected.id,
      title: title.trim() || defaultTitle,
      captureMode: mode === "window" ? "window" : mode === "region" ? "region" : "display",
      ...(captureRegion ? { captureRegion } : {}),
      includeMicrophone,
      captureClicks,
    });

    if (!state || state.status === "failed" || state.error || !state.recordingId) return;

    onClose();
    onStarted(state.recordingId);
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="source-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-dialog-title"
      >
        <header>
          <h2 id="source-dialog-title">{t("sourceTitle")}</h2>
          <Button
            size="icon"
            variant="ghost"
            title={actions("cancel")}
            aria-label={actions("cancel")}
            onClick={onClose}
          >
            <X size={17} />
          </Button>
        </header>

        <div className="capture-mode-grid" role="group" aria-label={t("steps.mode")}>
          {(Object.keys(modeIcons) as SourceMode[]).map((item) => {
            const Icon = modeIcons[item];
            const key = item === "full-screen" ? "fullScreen" : item;

            return (
              <button
                key={item}
                type="button"
                className={cn("capture-mode", mode === item && "capture-mode-selected")}
                aria-pressed={mode === item}
                onClick={() => setMode(item)}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{t(`modes.${key}`)}</span>
              </button>
            );
          })}
        </div>

        <div
          className="source-grid"
          role="group"
          aria-label={t(mode === "window" ? "steps.window" : "steps.screen")}
          aria-busy={snapshot.loadingSources}
        >
          {availableSources.map((source) => (
            <SourceTile
              key={source.id}
              source={source}
              selected={source.id === selected?.id}
              onSelect={() => setSelectedId(source.id)}
            />
          ))}
          {snapshot.loadingSources && availableSources.length === 0 && (
            <>
              <span className="source-tile-skeleton" aria-hidden="true" />
              <span className="source-tile-skeleton" aria-hidden="true" />
            </>
          )}
          {!snapshot.loadingSources && availableSources.length === 0 && <p>{t("noSources")}</p>}
        </div>

        <label className="recording-title-field">
          <span>{t("titleLabel")}</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={defaultTitle}
          />
        </label>

        {snapshot.error && (
          <p className="recording-error" role="alert">
            {snapshot.error}
          </p>
        )}
        <footer>
          <div className="source-footer-options">
            <label className="switch-row source-option-toggle" title={t("microphoneHint")}>
              <Mic size={18} aria-hidden="true" />
              <span className="source-option-label">{t("microphone")}</span>
              <input
                type="checkbox"
                aria-label={t("microphone")}
                checked={includeMicrophone}
                onChange={(event) => setIncludeMicrophone(event.target.checked)}
              />
            </label>
            <label className="switch-row source-option-toggle" title={t("captureClicksHint")}>
              <MousePointer2 size={18} aria-hidden="true" />
              <span className="source-option-label">{t("captureClicks")}</span>
              <input
                type="checkbox"
                aria-label={t("captureClicks")}
                checked={captureClicks}
                onChange={(event) => setCaptureClicks(event.target.checked)}
              />
            </label>
          </div>
          <div className="source-dialog-actions">
            <Button variant="secondary" onClick={onClose}>
              {actions("cancel")}
            </Button>
            <Button
              disabled={
                !selected || snapshot.status === "preparing" || snapshot.isChangingRecording
              }
              onClick={() => void start()}
            >
              <Check size={15} />
              {snapshot.status === "preparing" ? t("preparing") : t("start")}
            </Button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function SourceTile({
  source,
  selected,
  onSelect,
}: {
  source: CaptureSource;
  selected: boolean;
  onSelect(): void;
}) {
  const Icon = source.type === "window" ? AppWindow : Monitor;

  return (
    <button
      type="button"
      className={cn("source-tile", selected && "source-tile-selected")}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="source-tile-preview">
        <Image src={source.thumbnailDataUrl} alt="" width={320} height={180} unoptimized />
      </span>
      <span className="source-tile-name">
        <Icon size={14} aria-hidden="true" />
        <span>{source.name}</span>
        {selected && <Check className="source-tile-check" size={15} aria-hidden="true" />}
      </span>
    </button>
  );
}
