import { GripHorizontal, MousePointer2, Pause, Play, Square } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/Button";
import { formatDuration } from "@/lib/Format";
import { useRecording } from "../hooks/useRecording";

export default function RecordingToolbarPage() {
  const t = useTranslations("recording");
  const { snapshot, stop, pause, resume, setClickTracking } = useRecording();
  const paused = snapshot.status === "paused";

  return (
    <main className="recording-toolbar" aria-label={t("toolbarLabel")}>
      <span className="recording-toolbar-drag" title={t("dragToolbar")}>
        <GripHorizontal size={16} />
      </span>
      <span
        className={
          paused ? "recording-toolbar-dot recording-toolbar-dot-paused" : "recording-toolbar-dot"
        }
        aria-hidden="true"
      />
      <div className="recording-toolbar-copy">
        <strong>{formatDuration(snapshot.elapsedMs, "00:00")}</strong>
        <span>{paused ? t("paused") : t("recordingActive")}</span>
      </div>
      <Button
        className="recording-toolbar-clicks"
        size="icon"
        variant="ghost"
        title={t("toggleClickTracking")}
        aria-label={t("toggleClickTracking")}
        aria-pressed={snapshot.captureClicks}
        disabled={snapshot.isChangingRecording || (snapshot.status !== "recording" && !paused)}
        onClick={() => void setClickTracking(!snapshot.captureClicks)}
      >
        <MousePointer2 size={16} />
      </Button>
      {paused ? (
        <Button
          className="recording-toolbar-stop"
          size="sm"
          title={t("resumeRecording")}
          onClick={() => void resume()}
        >
          <Play size={12} />
          {t("resume")}
        </Button>
      ) : (
        <Button
          className="recording-toolbar-stop"
          size="sm"
          variant="secondary"
          title={t("pauseRecording")}
          disabled={snapshot.status !== "recording"}
          onClick={() => void pause()}
        >
          <Pause size={12} />
          {t("pause")}
        </Button>
      )}
      <Button
        className="recording-toolbar-stop"
        size="sm"
        disabled={
          (snapshot.status !== "recording" && snapshot.status !== "paused") ||
          snapshot.elapsedMs < 2_000
        }
        onClick={() => void stop()}
      >
        <Square size={12} />
        {t("stop")}
      </Button>
    </main>
  );
}
