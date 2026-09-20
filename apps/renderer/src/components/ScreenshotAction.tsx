import { Image as ImageIcon, ImagePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ClickEvent } from "@path/shared";
import { useScreenshotUrl } from "@/hooks/useScreenshotUrl";
import { formatPlayerTime } from "@/lib/Format";

export function ScreenshotAction({
  click,
  onOpen,
  onInsert,
  onPreview,
  onPreviewEnd,
}: {
  click: ClickEvent;
  onOpen(url: string): void;
  onInsert?(url: string): void;
  onPreview(url: string, anchor: DOMRect): void;
  onPreviewEnd(): void;
}) {
  const t = useTranslations();
  const url = useScreenshotUrl(click);

  if (!url) return null;

  if (!onInsert) {
    return (
      <button
        type="button"
        className="activity-screenshot-action"
        title={t("recording.openScreenshot")}
        aria-label={t("recording.openScreenshotAt", {
          time: formatPlayerTime(click.timestampMs / 1_000),
        })}
        onClick={() => onOpen(url)}
        onMouseEnter={(event) => onPreview(url, event.currentTarget.getBoundingClientRect())}
        onMouseLeave={onPreviewEnd}
        onFocus={(event) => onPreview(url, event.currentTarget.getBoundingClientRect())}
        onBlur={onPreviewEnd}
      >
        <ImageIcon size={14} />
      </button>
    );
  }

  return (
    <div className="activity-screenshot-actions">
      <button
        type="button"
        className="activity-screenshot-action"
        title={t("guide.insertScreenshot")}
        aria-label={t("guide.insertScreenshot")}
        onClick={(event) => {
          event.stopPropagation();
          onInsert(url);
        }}
      >
        <ImagePlus size={14} />
      </button>
      <button
        type="button"
        className="activity-screenshot-action"
        title={t("recording.openScreenshot")}
        aria-label={t("recording.openScreenshotAt", {
          time: formatPlayerTime(click.timestampMs / 1_000),
        })}
        onClick={() => onOpen(url)}
        onMouseEnter={(event) => onPreview(url, event.currentTarget.getBoundingClientRect())}
        onMouseLeave={onPreviewEnd}
        onFocus={(event) => onPreview(url, event.currentTarget.getBoundingClientRect())}
        onBlur={onPreviewEnd}
      >
        <ImageIcon size={14} />
      </button>
    </div>
  );
}
