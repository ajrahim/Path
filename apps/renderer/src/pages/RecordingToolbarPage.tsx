import { GripHorizontal, MousePointer2, Square } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/Button";
import { formatDuration } from "@/lib/Format";
import { useRecording } from "../hooks/useRecording";

export default function RecordingToolbarPage() {
  const t = useTranslations("recording");
  const { snapshot, stop } = useRecording();

  return (
    <main className="recording-toolbar" aria-label={t("toolbarLabel")}>
      <span className="recording-toolbar-drag" title={t("dragToolbar")}>
        <GripHorizontal size={16} />
      </span>
      <span className="recording-toolbar-dot" aria-hidden="true" />
      <div className="recording-toolbar-copy">
        <strong>{formatDuration(snapshot.elapsedMs, "00:00")}</strong>
        <span>{t("recordingActive")}</span>
      </div>
      {snapshot.captureClicks && (
        <span className="recording-toolbar-clicks">
          <MousePointer2 size={14} />
          {t("clicksActive")}
        </span>
      )}
      <Button
        className="recording-toolbar-stop"
        size="sm"
        disabled={snapshot.status !== "recording" || snapshot.elapsedMs < 2_000}
        onClick={() => void stop()}
      >
        <Square size={12} />
        {t("stop")}
      </Button>
    </main>
  );
}
