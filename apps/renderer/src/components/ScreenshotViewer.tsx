import { FolderOpen, ImagePlus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ClickEvent } from "@path/shared";
import { formatPlayerTime } from "@/lib/Format";
import { clickLabel } from "@/lib/ActivityPresentation";
import { ScreenshotImage } from "./ScreenshotImage";

const HOVER_CARD_WIDTH = 260;
const HOVER_CARD_HEIGHT = 174;
const HOVER_CARD_MARGIN = 12;

export function screenshotHoverPosition(anchor: DOMRect): { top: number; left: number } {
  return {
    top:
      anchor.top > HOVER_CARD_HEIGHT + HOVER_CARD_MARGIN
        ? anchor.top - HOVER_CARD_HEIGHT - 8
        : anchor.bottom + 8,
    left: Math.max(
      HOVER_CARD_MARGIN,
      Math.min(
        anchor.right - HOVER_CARD_WIDTH,
        window.innerWidth - HOVER_CARD_WIDTH - HOVER_CARD_MARGIN,
      ),
    ),
  };
}

export function ScreenshotHoverCard({
  click,
  url,
  top,
  left,
  showHotspot,
}: {
  click: ClickEvent;
  url: string;
  top: number;
  left: number;
  showHotspot: boolean;
}) {
  return (
    <div className="screenshot-hover-card" style={{ top, left }}>
      <ScreenshotImage click={click} url={url} showHotspot={showHotspot} />
    </div>
  );
}

export function ScreenshotViewer({
  click,
  url,
  showHotspot,
  error,
  onInsert,
  onReveal,
  onClose,
}: {
  click: ClickEvent;
  url: string;
  showHotspot: boolean;
  error: string | null;
  onInsert(): void;
  onReveal(): void;
  onClose(): void;
}) {
  const t = useTranslations();

  return (
    <div
      className="modal-backdrop screenshot-viewer-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
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
            <strong>{clickLabel(t, click.button)}</strong>
            <span>{formatPlayerTime(click.timestampMs / 1_000)}</span>
          </div>
          <div className="screenshot-viewer-actions">
            <button className="screenshot-reveal-button" type="button" onClick={onInsert}>
              <ImagePlus size={15} />
              <span>{t("guide.insertScreenshot")}</span>
            </button>
            <button className="screenshot-reveal-button" type="button" onClick={onReveal}>
              <FolderOpen size={15} />
              <span>{t("recording.revealScreenshot")}</span>
            </button>
            <button type="button" title={t("recording.closeScreenshot")} onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </header>
        <ScreenshotImage click={click} url={url} showHotspot={showHotspot} />
        {error && (
          <p className="screenshot-viewer-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
