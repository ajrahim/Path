import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ImagePlus, MoreHorizontal, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

export function ActivityActionMenu({
  onInsert,
  onRemove,
  removeLabel,
  removeDisabled = false,
}: {
  onInsert?(): void;
  onRemove?(): void;
  removeLabel?: string;
  removeDisabled?: boolean;
}) {
  const t = useTranslations();
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!position) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    function dismiss(event: PointerEvent) {
      const target = event.target as Node;

      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        setPosition(null);
      }
    }

    function closeOnMove() {
      setPosition(null);
    }

    document.addEventListener("pointerdown", dismiss);
    window.addEventListener("resize", closeOnMove);
    window.addEventListener("scroll", closeOnMove, true);

    return () => {
      document.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("resize", closeOnMove);
      window.removeEventListener("scroll", closeOnMove, true);
    };
  }, [position]);

  function close() {
    setPosition(null);
    triggerRef.current?.focus();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="activity-row-action"
        aria-label={t("actions.more")}
        title={t("actions.more")}
        aria-haspopup="menu"
        aria-expanded={Boolean(position)}
        aria-controls={position ? id : undefined}
        onClick={() => {
          const rect = triggerRef.current?.getBoundingClientRect();

          if (!rect) return;

          const height = (onInsert && onRemove ? 2 : 1) * 36 + 10;

          setPosition(
            position
              ? null
              : {
                  top:
                    rect.bottom + height + 8 <= window.innerHeight
                      ? rect.bottom + 4
                      : Math.max(8, rect.top - height - 4),
                  left: Math.max(8, Math.min(rect.right - 200, window.innerWidth - 208)),
                },
          );
        }}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {position &&
        createPortal(
          <div
            id={id}
            ref={menuRef}
            className="activity-action-menu"
            role="menu"
            aria-label={t("actions.more")}
            style={position}
            onKeyDown={(event) => {
              if (event.key === "Escape" || event.key === "Tab") {
                event.preventDefault();
                event.stopPropagation();
                close();
              }

              if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                event.stopPropagation();
                const items = [
                  ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    "button:not(:disabled)",
                  ),
                ];

                const current = items.indexOf(document.activeElement as HTMLButtonElement);
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? items.length - 1
                      : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
                        items.length;

                items[next]?.focus();
              }
            }}
          >
            {onInsert && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  close();
                  onInsert();
                }}
              >
                <ImagePlus size={14} aria-hidden="true" />
                {t("guide.insertScreenshot")}
              </button>
            )}
            {onRemove && (
              <button
                type="button"
                role="menuitem"
                className="activity-menu-remove"
                disabled={removeDisabled}
                onClick={() => {
                  close();
                  onRemove();
                }}
              >
                <Trash2 size={14} aria-hidden="true" />
                {removeLabel}
              </button>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
