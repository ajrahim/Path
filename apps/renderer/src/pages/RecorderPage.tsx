import { useEffect, useState } from "react";
import {
  AppWindow,
  ChevronDown,
  Crop,
  ExternalLink,
  Mic,
  Monitor,
  MousePointer2,
  Play,
  ScreenShare,
  Square,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { CaptureMode } from "@path/shared";
import { Button } from "@/components/Button";
import { getDesktopApi } from "@/lib/Desktop";
import { formatDuration } from "@/lib/Format";
import { cn } from "@/lib/ClassNames";
import { useRecording } from "../hooks/useRecording";

type PopoverMode = "full-screen" | CaptureMode;

export default function RecorderPage() {
  const t = useTranslations("recording");
  const { snapshot, loadSources, start: startCapture, stop } = useRecording();
  const [expanded, setExpanded] = useState(true);
  const [mode, setMode] = useState<PopoverMode>("full-screen");
  const [sourceId, setSourceId] = useState("");
  const [includeMicrophone, setIncludeMicrophone] = useState(false);
  const [captureClicks, setCaptureClicks] = useState(true);

  useEffect(() => {
    const request = loadSources();

    return () => request.abort();
  }, [loadSources]);

  const sourceType = mode === "window" ? "window" : "screen";
  const sources = snapshot.sources.filter((source) => source.type === sourceType);
  const source = sources.find((item) => item.id === sourceId) ?? sources[0] ?? null;
  const active = ["preparing", "recording", "stopping", "processing"].includes(snapshot.status);
  const optionsVisible = !active && expanded;

  useEffect(() => {
    // The native window must shrink with the controls to avoid an invisible hit area.
    void getDesktopApi()?.app.setRecorderPopoverExpanded?.({ expanded: optionsVisible });
  }, [optionsVisible]);

  async function start(): Promise<void> {
    if (!source) return;

    let captureRegion;

    if (mode === "region") {
      if (!source.displayId) return;

      captureRegion = await getDesktopApi()?.recording.selectRegion({
        sourceId: source.id,
        displayId: source.displayId,
      });
      if (!captureRegion) return;
    }

    await startCapture({
      sourceId: source.id,
      title: t("defaultTitle"),
      captureMode: mode === "window" ? "window" : mode === "region" ? "region" : "display",
      ...(captureRegion ? { captureRegion } : {}),
      includeMicrophone,
      captureClicks,
    });
  }

  return (
    <main className="recorder-popover">
      {active ? (
        <section className="recorder-summary">
          <span className="recorder-state-icon recorder-state-active">
            {snapshot.status === "recording" ? <Square size={14} /> : <Play size={15} />}
          </span>
          <div>
            <strong>
              {snapshot.status === "recording"
                ? formatDuration(snapshot.elapsedMs, "00:00")
                : t(snapshot.status === "processing" ? "processing" : "preparing")}
            </strong>
          </div>
          <div className="recorder-summary-actions">
            {snapshot.status === "recording" && (
              <Button size="sm" disabled={snapshot.elapsedMs < 2_000} onClick={() => void stop()}>
                <Square size={13} />
                {t("stop")}
              </Button>
            )}
            <button
              type="button"
              className="open-main-app"
              title={t("openApplication")}
              aria-label={t("openApplication")}
              onClick={() => void getDesktopApi()?.app.showMainWindow()}
            >
              <ExternalLink aria-hidden="true" size={17} />
            </button>
          </div>
        </section>
      ) : (
        <section className="recorder-primary-row">
          <Button
            className="recorder-start"
            disabled={!source || snapshot.isChangingRecording}
            onClick={() => void start()}
          >
            <Play size={15} />
            {t("start")}
          </Button>
          <div className="recorder-primary-actions">
            <div className="recorder-option-toggles">
              <button
                type="button"
                title={t("microphone")}
                aria-label={t("microphone")}
                aria-pressed={includeMicrophone}
                onClick={() => setIncludeMicrophone((value) => !value)}
              >
                <Mic aria-hidden="true" size={17} />
              </button>
              <button
                type="button"
                title={t("captureClicks")}
                aria-label={t("captureClicks")}
                aria-pressed={captureClicks}
                onClick={() => setCaptureClicks((value) => !value)}
              >
                <MousePointer2 aria-hidden="true" size={17} />
              </button>
            </div>
            <button
              type="button"
              className="open-main-app"
              title={t("openApplication")}
              aria-label={t("openApplication")}
              onClick={() => void getDesktopApi()?.app.showMainWindow()}
            >
              <ExternalLink aria-hidden="true" size={17} />
            </button>
            <Button
              className="recorder-expand"
              size="icon"
              variant="ghost"
              title={t("chooseSource")}
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              <ChevronDown size={17} />
            </Button>
          </div>
        </section>
      )}

      {optionsVisible && (
        <section className="recorder-options">
          <span className="recorder-options-label">{t("chooseSource")}</span>
          <div className="recorder-mode-grid">
            {(
              [
                ["full-screen", ScreenShare, "modes.fullScreen"],
                ["display", Monitor, "modes.display"],
                ["window", AppWindow, "modes.window"],
                ["region", Crop, "modes.region"],
              ] as const
            ).map(([value, Icon, label]) => (
              <button
                key={value}
                className={cn(mode === value && "selected")}
                onClick={() => setMode(value)}
              >
                <Icon size={20} />
                <span>{t(label)}</span>
              </button>
            ))}
          </div>
          <label className="popover-source-select">
            <span className="sr-only">{t("chooseSource")}</span>
            <select
              aria-label={t("chooseSource")}
              value={source?.id ?? ""}
              onChange={(event) => setSourceId(event.target.value)}
            >
              {sources.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        </section>
      )}
      {snapshot.error && <p className="recording-error">{snapshot.error}</p>}
    </main>
  );
}
