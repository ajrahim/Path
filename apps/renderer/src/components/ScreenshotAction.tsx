import { Image as ImageIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ClickEvent } from "@path/shared";
import { useScreenshotUrl } from "@/hooks/useScreenshotUrl";
import { ActivityActionMenu } from "./ActivityActionMenu";
import { formatPlayerTime } from "@/lib/Format";

export function ScreenshotAction({
  click,
  onOpen,
  onInsert,
  onRemove,
  removeDisabled,
  onPreview,
  onPreviewEnd,
}: {
  click: ClickEvent;
  onOpen(url: string): void;
  onInsert?(url: string): void;
  onRemove?(): void;
  removeDisabled?: boolean;
  onPreview(url: string, anchor: DOMRect): void;
  onPreviewEnd(): void;
}) {
  const t = useTranslations();
  const url = useScreenshotUrl(click);

  return (
    <>
      {url && (
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
          <ImageIcon size={14} aria-hidden="true" />
        </button>
      )}
      {(onRemove || (url && onInsert)) && (
        <ActivityActionMenu
          onInsert={url && onInsert ? () => onInsert(url) : undefined}
          onRemove={onRemove}
          removeLabel={t("recording.removeClick")}
          removeDisabled={removeDisabled}
        />
      )}
    </>
  );
}
