import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useOutsidePointerDown } from "../hooks/useOutsidePointerDown";

export interface HistoryMenuItem {
  label: string;
  icon: ReactNode;
  onSelect(): void;
  disabled?: boolean;
  danger?: boolean;
}

interface HistoryMenuAnchor {
  x: number;
  y: number;
}

const MENU_WIDTH = 184;
const MENU_MARGIN = 8;

/** Cursor-anchored context menu for the history sidebar; opened by right-click. */
export function HistoryMenu({
  label,
  anchor,
  items,
  onClose,
  returnFocus,
}: {
  label: string;
  anchor: HistoryMenuAnchor | null;
  items: HistoryMenuItem[];
  onClose(): void;
  returnFocus(): void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId();

  const height = items.length * 36 + 10;
  const position = anchor
    ? {
        top:
          anchor.y + height + MENU_MARGIN > window.innerHeight
            ? Math.max(MENU_MARGIN, anchor.y - height - 4)
            : Math.max(MENU_MARGIN, anchor.y + 4),
        left: Math.max(
          MENU_MARGIN,
          Math.min(anchor.x - 8, window.innerWidth - MENU_WIDTH - MENU_MARGIN),
        ),
      }
    : null;

  useOutsidePointerDown(anchor !== null, [menuRef], onClose);

  useEffect(() => {
    if (!anchor) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();

    const onScroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };

    window.addEventListener("resize", onClose);
    document.addEventListener("scroll", onScroll, true);

    return () => {
      window.removeEventListener("resize", onClose);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [anchor, onClose]);

  if (!anchor || !position) return null;

  function dismiss(returnFocusAfter: boolean) {
    onClose();

    if (returnFocusAfter) returnFocus();
  }

  return createPortal(
    <div
      ref={menuRef}
      id={id}
      className="history-action-menu"
      role="menu"
      aria-label={label}
      style={position}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onClose();
      }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        const buttons = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
        ];

        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);

        if (event.key === "Escape" || event.key === "Tab") {
          if (event.key === "Escape") event.preventDefault();
          dismiss(true);

          return;
        }

        let next: number;

        if (event.key === "ArrowDown") {
          next = (index + 1) % buttons.length;
        } else if (event.key === "ArrowUp") {
          next = (index - 1 + buttons.length) % buttons.length;
        } else if (event.key === "Home") {
          next = 0;
        } else if (event.key === "End") {
          next = buttons.length - 1;
        } else {
          return;
        }

        event.preventDefault();
        buttons[next]?.focus();
      }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          tabIndex={-1}
          disabled={item.disabled}
          className={item.danger ? "danger" : undefined}
          onClick={() => {
            dismiss(true);
            item.onSelect();
          }}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}
