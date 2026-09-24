import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { instructionFlowIcons, type InstructionFlowIcon } from "@path/shared";
import { InstructionFlowGlyph } from "./InstructionFlowGlyph";

export function InstructionFlowIconSelect({
  icon,
  disabled,
  onChange,
}: {
  icon: InstructionFlowIcon;
  disabled: boolean;
  onChange(icon: InstructionFlowIcon): void;
}) {
  const t = useTranslations("guide");
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();

    function closeOutside(event: PointerEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("pointerdown", closeOutside);

    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  function close(): void {
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div
      className="prompt-icon-select"
      ref={rootRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (open && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="prompt-icon-trigger"
        aria-label={t("promptIcon")}
        title={t("promptIcon")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <InstructionFlowGlyph icon={icon} size={17} aria-hidden="true" />
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <div
          id={menuId}
          ref={menuRef}
          className="prompt-icon-menu"
          role="menu"
          aria-label={t("promptIcon")}
          onKeyDown={(event) => {
            const items = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
            );

            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            let next = index;

            if (event.key === "ArrowRight") {next = (index + 1) % items.length;}
            else if (event.key === "ArrowLeft") {next = (index + items.length - 1) % items.length;}
            else if (event.key === "ArrowDown" || event.key === "ArrowUp")
              {next = (index + 5) % items.length;}
            else if (event.key === "Home") {next = 0;}
            else if (event.key === "End") {next = items.length - 1;}
            else if (event.key === "Tab") {
              close();

              return;
            } else {return;}

            event.preventDefault();
            items[next]?.focus();
          }}
        >
          {instructionFlowIcons.map((value) => (
            <button
              key={value}
              type="button"
              role="menuitemradio"
              tabIndex={-1}
              aria-checked={value === icon}
              aria-label={t(`promptIcons.${value}`)}
              title={t(`promptIcons.${value}`)}
              disabled={disabled}
              onClick={() => {
                onChange(value);
                close();
              }}
            >
              <InstructionFlowGlyph icon={value} size={18} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
