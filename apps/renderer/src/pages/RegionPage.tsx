import { useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/Button";
import { getDesktopApi } from "@/lib/Desktop";

interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export default function RegionPage() {
  const t = useTranslations("region");
  const selectionRef = useRef<HTMLDivElement>(null);
  const origin = useRef({ x: 0, y: 0 });
  const [rectangle, setRectangle] = useState<Rectangle | null>(null);

  function beginSelection(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.target !== event.currentTarget) return;

    origin.current = { x: event.clientX, y: event.clientY };
    setRectangle({ x: event.clientX, y: event.clientY, width: 1, height: 1 });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function updateSelection(event: React.PointerEvent<HTMLDivElement>): void {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;

    const x = Math.min(origin.current.x, event.clientX);
    const y = Math.min(origin.current.y, event.clientY);

    setRectangle({
      x,
      y,
      width: Math.abs(event.clientX - origin.current.x),
      height: Math.abs(event.clientY - origin.current.y),
    });
  }

  async function confirm(): Promise<void> {
    // Confirm the rendered bounds so the captured region matches the visible selection.
    const bounds = selectionRef.current?.getBoundingClientRect();

    if (!bounds) return;

    await getDesktopApi()?.region.confirm({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    });
  }

  return (
    <div
      className="region-overlay"
      onPointerDown={beginSelection}
      onPointerMove={updateSelection}
      onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
    >
      {!rectangle && <div className="region-hint">{t("dragPrompt")}</div>}
      {rectangle && (
        <div
          ref={selectionRef}
          className="region-selection"
          style={{
            left: rectangle.x,
            top: rectangle.y,
            width: rectangle.width,
            height: rectangle.height,
          }}
        >
          <div className="region-size">
            {Math.round(rectangle.width)} × {Math.round(rectangle.height)}
          </div>
          <div className="region-actions">
            <Button
              size="icon"
              variant="secondary"
              title={t("cancel")}
              onClick={() => void getDesktopApi()?.region.cancel()}
            >
              <X size={16} />
            </Button>
            <Button
              size="icon"
              title={t("confirm")}
              disabled={rectangle.width < 24 || rectangle.height < 24}
              onClick={() => void confirm()}
            >
              <Check size={16} />
            </Button>
          </div>
        </div>
      )}
      {!rectangle && (
        <Button
          className="region-cancel"
          variant="secondary"
          onClick={() => void getDesktopApi()?.region.cancel()}
        >
          <X size={15} />
          {t("cancel")}
        </Button>
      )}
    </div>
  );
}
