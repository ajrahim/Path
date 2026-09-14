import type { ClickEvent } from "@path/shared";
import { useScreenshotLayout } from "@/hooks/useScreenshotLayout";

export function ScreenshotImage({
  click,
  url,
  showHotspot,
}: {
  click: ClickEvent;
  url: string;
  showHotspot: boolean;
}) {
  const { containerRef, imageLayout } = useScreenshotLayout(url);

  return (
    <div
      ref={containerRef}
      className="screenshot-image"
      style={{ backgroundImage: `url("${url}")` }}
    >
      {showHotspot && click.normalizedX !== null && click.normalizedY !== null && imageLayout && (
        <span
          style={{
            left: imageLayout.left + click.normalizedX * imageLayout.width,
            top: imageLayout.top + click.normalizedY * imageLayout.height,
          }}
        />
      )}
    </div>
  );
}
