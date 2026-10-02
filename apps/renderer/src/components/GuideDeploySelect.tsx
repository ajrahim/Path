import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { useOutsidePointerDown } from "../hooks/useOutsidePointerDown";

export function GuideDeploySelect({
  label,
  value,
  text,
  icon,
  disabled,
  options,
  onSelect,
}: {
  label: string;
  value: string;
  text: string;
  icon: ReactNode;
  disabled: boolean;
  options: { value: string; label: string; action?: boolean }[];
  onSelect(value: string): void;
}) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const initialFocus = useRef<"selected" | "last">("selected");

  useOutsidePointerDown(open, [rootRef], () => setOpen(false));

  useEffect(() => {
    if (!open) return;

    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>("[role^='menuitem']");
    const selected = menuRef.current?.querySelector<HTMLButtonElement>("[aria-checked='true']");
    const target =
      initialFocus.current === "last" ? items?.[items.length - 1] : (selected ?? items?.[0]);

    target?.focus({ preventScroll: true });
  }, [open]);

  function close(): void {
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div
      ref={rootRef}
      className="guide-deploy-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="guide-deploy-trigger"
        data-selected={value !== ""}
        aria-label={`${label}: ${text}`}
        aria-haspopup="menu"
        aria-expanded={open && !disabled}
        aria-controls={open && !disabled ? id : undefined}
        title={`${label}: ${text}`}
        disabled={disabled}
        onClick={() => {
          initialFocus.current = "selected";
          setOpen((current) => !current);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            initialFocus.current = event.key === "ArrowUp" ? "last" : "selected";
            setOpen(true);
          }
        }}
      >
        {icon}
        <span>{text}</span>
      </button>
      {open && !disabled && (
        <div
          ref={menuRef}
          id={id}
          role="menu"
          aria-label={label}
          className="guide-deploy-menu"
          onKeyDown={(event) => {
            const items = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>("[role^='menuitem']"),
            );

            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            let next = index;

            if (event.key === "ArrowDown") {
              next = (index + 1) % items.length;
            } else if (event.key === "ArrowUp") {
              next = (index - 1 + items.length) % items.length;
            } else if (event.key === "Home") {
              next = 0;
            } else if (event.key === "End") {
              next = items.length - 1;
            } else if (event.key === "Escape" || event.key === "Tab") {
              if (event.key === "Escape") event.preventDefault();
              event.stopPropagation();
              close();

              return;
            } else {
              return;
            }

            event.preventDefault();
            items[next]?.focus();
          }}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role={option.action ? "menuitem" : "menuitemradio"}
              aria-checked={option.action ? undefined : value === option.value}
              className="guide-deploy-option"
              tabIndex={-1}
              onClick={() => {
                close();
                onSelect(option.value);
              }}
            >
              <span>{option.label}</span>
              {!option.action && value === option.value && <Check size={14} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
