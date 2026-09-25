import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, History } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { DocumentRevisionSummary } from "@path/shared";
import { useOutsidePointerDown } from "../hooks/useOutsidePointerDown";

/**
 * Document history picker in the editor footer. It uses the same borderless trigger, check-marked
 * options, and keyboard model as the prompt picker, and opens upward because it sits at the bottom.
 */
export function GuideVersionSelect({
  revisions,
  hasOlderRevisions,
  shownNumber,
  currentNumber,
  savedNumber,
  disabled,
  onSelect,
  onLoadOlder,
}: {
  revisions: DocumentRevisionSummary[];
  hasOlderRevisions: boolean;
  /** The version in the editor: a previewed one, or the one the editor text came from. */
  shownNumber: number | null;
  currentNumber: number | null;
  savedNumber: number | null;
  disabled: boolean;
  onSelect(number: number): void;
  onLoadOlder(): void;
}) {
  const t = useTranslations("guide");
  const locale = useLocale();
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const initialFocus = useRef<"selected" | "last">("selected");
  const label =
    shownNumber === null ? t("versionCurrent") : t("versionName", { number: shownNumber });

  useOutsidePointerDown(open, [rootRef], () => setOpen(false));

  useEffect(() => {
    if (!open) return;

    // ArrowUp enters from the end; other openings focus the version in the editor.
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>("[role^='menuitem']");
    const selected = menuRef.current?.querySelector<HTMLButtonElement>("[aria-checked='true']");
    const target =
      initialFocus.current === "last" ? items?.[items.length - 1] : (selected ?? items?.[0]);

    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "nearest" });
  }, [open]);

  function close(): void {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function detail(revision: DocumentRevisionSummary): string {
    const parts = [
      revision.number === currentNumber ? t("versionCurrentTag") : null,
      t(`revisionKinds.${revision.kind}`),
      new Date(revision.createdAt).toLocaleString(locale, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
      // A save of unchanged text marks an existing revision saved; a saved revision says so already.
      revision.number === savedNumber && revision.kind !== "saved" ? t("versionSavedTag") : null,
    ];

    return parts.filter((part): part is string => part !== null).join(" · ");
  }

  return (
    <div
      ref={rootRef}
      className="guide-version-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="guide-version-trigger"
        aria-label={`${t("versionLabel")}: ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
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
        <span>{label}</span>
        <ChevronDown className="guide-version-chevron" aria-hidden="true" size={14} />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          className="guide-version-list"
          role="menu"
          aria-label={t("versionLabel")}
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
          {revisions.map((revision) => (
            <button
              key={revision.number}
              type="button"
              role="menuitemradio"
              aria-checked={revision.number === shownNumber}
              className="guide-version-option"
              tabIndex={-1}
              onClick={() => {
                close();
                onSelect(revision.number);
              }}
            >
              <span className="guide-version-option-text">
                <span>{t("versionName", { number: revision.number })}</span>
                <small>{detail(revision)}</small>
              </span>
              {revision.number === shownNumber && (
                <Check className="guide-version-check" aria-hidden="true" size={15} />
              )}
            </button>
          ))}
          {hasOlderRevisions && (
            <>
              <div className="guide-version-separator" role="separator" />
              <button
                type="button"
                role="menuitem"
                className="guide-version-option guide-version-older"
                tabIndex={-1}
                onClick={onLoadOlder}
              >
                <History aria-hidden="true" size={15} />
                <span>{t("versionOlder")}</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
