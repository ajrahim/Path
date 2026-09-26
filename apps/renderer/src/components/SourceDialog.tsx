import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { AppWindow, Check, Crop, Mic, Monitor, MousePointer2, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { CaptureMode, CaptureSource } from "@path/shared";
import { Button } from "@/components/Button";
import { formatDefaultRecordingTitle } from "@/lib/Format";
import { getDesktopApi } from "@/lib/Desktop";
import { cn } from "@/lib/ClassNames";
import { useRecording } from "../hooks/useRecording";

interface SourceDialogProps {
  open: boolean;
  onClose(): void;
  onStarted(recordingId: string | null): void;
}

const modeIcons = { display: Monitor, window: AppWindow, region: Crop };

export function SourceDialog({ open, onClose, onStarted }: SourceDialogProps) {
  const t = useTranslations("recording");
  const locale = useLocale();
  const actions = useTranslations("actions");
  const { snapshot, loadSources, start: startCapture } = useRecording();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<CaptureMode>("display");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [includeMicrophone, setIncludeMicrophone] = useState(true);
  const [captureClicks, setCaptureClicks] = useState(true);
  const [defaultTitle] = useState(() => formatDefaultRecordingTitle(new Date(), locale));
  const [title, setTitle] = useState(defaultTitle);

  useEffect(() => {
    if (!open) return;

    const dialog = dialogRef.current;

    dialog?.showModal();
    const request = loadSources();

    return () => {
      request.abort();
      dialog?.close();
    };
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
      captureMode: mode,
      ...(captureRegion ? { captureRegion } : {}),
      includeMicrophone,
      captureClicks,
    });

    if (!state || state.status === "failed" || state.error || !state.recordingId) return;

    onClose();
    onStarted(state.recordingId);
  }

  return (
    <dialog
      ref={dialogRef}
      className="source-dialog"
      aria-labelledby="source-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;

        const bounds = event.currentTarget.getBoundingClientRect();

        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        ) {
          onClose();
        }
      }}
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
        {(Object.keys(modeIcons) as CaptureMode[]).map((item) => {
          const Icon = modeIcons[item];

          return (
            <button
              key={item}
              type="button"
              className={cn("capture-mode", mode === item && "capture-mode-selected")}
              aria-pressed={mode === item}
              onClick={() => setMode(item)}
            >
              <Icon size={16} aria-hidden="true" />
              <span>{t(`modes.${item}`)}</span>
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

      {mode === "region" && <p className="source-region-hint">{t("regionHint")}</p>}

      {snapshot.error && (
        <p className="recording-error" role="alert">
          {snapshot.error}
        </p>
      )}
      <footer>
        <label className="recording-title-field">
          <span className="sr-only">{t("titleLabel")}</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t("titleLabel")}
            title={t("titleLabel")}
          />
        </label>
        <div className="source-footer-options">
          <Button
            className="source-option-toggle"
            variant="ghost"
            size="icon"
            title={`${t("microphone")}: ${t("microphoneHint")}`}
            aria-label={t("microphone")}
            aria-pressed={includeMicrophone}
            onClick={() => setIncludeMicrophone((enabled) => !enabled)}
          >
            <Mic size={18} aria-hidden="true" />
          </Button>
          <Button
            className="source-option-toggle"
            variant="ghost"
            size="icon"
            title={`${t("captureClicks")}: ${t("captureClicksHint")}`}
            aria-label={t("captureClicks")}
            aria-pressed={captureClicks}
            onClick={() => setCaptureClicks((enabled) => !enabled)}
          >
            <MousePointer2 size={18} aria-hidden="true" />
          </Button>
        </div>
        <Button
          disabled={!selected || snapshot.status === "preparing" || snapshot.isChangingRecording}
          onClick={() => void start()}
        >
          {snapshot.status === "preparing" ? t("preparing") : t("start")}
        </Button>
      </footer>
    </dialog>
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
  return (
    <button
      type="button"
      className={cn("source-tile", selected && "source-tile-selected")}
      aria-pressed={selected}
      title={source.name}
      onClick={onSelect}
    >
      <span className="source-tile-preview">
        <Image src={source.thumbnailDataUrl} alt="" width={320} height={180} unoptimized />
      </span>
      <span className="source-tile-name">
        <span>{source.name}</span>
        {selected && <Check className="source-tile-check" size={15} aria-hidden="true" />}
      </span>
    </button>
  );
}
