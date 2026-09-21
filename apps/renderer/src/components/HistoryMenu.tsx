import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface HistoryMenuItem {
  label: string;
  icon: ReactNode;
  onSelect(): void;
  disabled?: boolean;
  danger?: boolean;
}

export function HistoryMenu({
  label,
  children,
  items,
  className = "",
  disabled = false,
}: {
  label: string;
  children: ReactNode;
  items: HistoryMenuItem[];
  className?: string;
  disabled?: boolean;
}) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId();

  function close() {
    setPosition(null);
  }

  function open() {
    const rect = triggerRef.current?.getBoundingClientRect();

    if (!rect) return;
    const height = items.length * 36 + 10;

    setPosition({
      top:
        rect.bottom + height + 8 > window.innerHeight
          ? Math.max(8, rect.top - height - 4)
          : rect.bottom + 4,
      left: Math.max(8, Math.min(rect.right - 184, window.innerWidth - 192)),
    });
  }

  useEffect(() => {
    if (!position) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const outside = (event: PointerEvent) => {
      if (
        !menuRef.current?.contains(event.target as Node) &&
        !triggerRef.current?.contains(event.target as Node)
      ) {
        close();
      }
    };

    const onScroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) close();
    };

    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", close);
    document.addEventListener("scroll", onScroll, true);

    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [position]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={className}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={Boolean(position)}
        aria-controls={position ? id : undefined}
        disabled={disabled}
        onClick={() => (position ? close() : open())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            open();
          }
        }}
      >
        {children}
      </button>
      {position &&
        createPortal(
          <div
            ref={menuRef}
            id={id}
            className="history-action-menu"
            role="menu"
            aria-label={label}
            style={position}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) close();
            }}
            onKeyDown={(event) => {
              const buttons = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
              ];

              const index = buttons.indexOf(document.activeElement as HTMLButtonElement);

              if (event.key === "Escape" || event.key === "Tab") {
                if (event.key === "Escape") event.preventDefault();
                triggerRef.current?.focus();
                close();

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
                  close();
                  triggerRef.current?.focus();
                  item.onSelect();
                }}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
