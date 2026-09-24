import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { Check, ChevronDown, Pencil, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import type { InstructionFlow } from "@path/shared";
import { InstructionFlowGlyph } from "./InstructionFlowGlyph";

export function InstructionFlowSelect({
  selectedFlow,
  builtInFlows,
  customFlows,
  disabled,
  triggerRef,
  variant = "field",
  onSelect,
  onEdit,
}: {
  selectedFlow: InstructionFlow;
  builtInFlows: InstructionFlow[];
  customFlows: InstructionFlow[];
  disabled: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
  variant?: "field" | "title";
  onSelect(id: string): void;
  onEdit?(): void;
}) {
  const t = useTranslations("guide");
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const initialFocus = useRef<"selected" | "last">("selected");

  useEffect(() => {
    if (!open) return;

    // ArrowUp enters from the end; other openings preserve the selected flow as the focus target.
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>("[role^='menuitem']");
    const selected = menuRef.current?.querySelector<HTMLButtonElement>("[aria-checked='true']");
    const target =
      initialFocus.current === "last" ? items?.[items.length - 1] : (selected ?? items?.[0]);

    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "nearest" });

    function closeOutside(event: PointerEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("pointerdown", closeOutside);

    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  function choose(id: string): void {
    setOpen(false);
    triggerRef.current?.focus();
    onSelect(id);
  }

  function renderOption(flow: InstructionFlow) {
    const label =
      flow.id === "help-guide"
        ? t("helpGuide")
        : flow.id === "spec-document"
          ? t("specDocument")
          : flow.id === "provide-feedback"
            ? t("provideFeedback")
            : flow.name;

    return (
      <button
        key={flow.id}
        type="button"
        role="menuitemradio"
        aria-checked={flow.id === selectedFlow.id}
        className="guide-flow-option"
        tabIndex={-1}
        title={label}
        onClick={() => choose(flow.id)}
      >
        <InstructionFlowGlyph icon={flow.icon} aria-hidden="true" size={16} />
        <span>{label}</span>
        {flow.id === selectedFlow.id && (
          <Check className="guide-flow-check" aria-hidden="true" size={15} />
        )}
      </button>
    );
  }

  return (
    <div
      className={`guide-flow-select${variant === "title" ? " guide-flow-select-title" : ""}`}
      ref={rootRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <div className="guide-flow-control">
        <button
          ref={triggerRef}
          type="button"
          className="guide-flow-trigger"
          aria-label={`${t("documentFlow")}: ${selectedFlow.name}`}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          title={selectedFlow.name}
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
          <InstructionFlowGlyph
            icon={selectedFlow.icon}
            className="guide-flow-document-icon"
            aria-hidden="true"
            size={16}
          />
          <span>{selectedFlow.name}</span>
          <ChevronDown className="guide-flow-chevron" aria-hidden="true" size={14} />
        </button>
        {variant === "field" && onEdit && (
          <button
            type="button"
            className="guide-flow-edit"
            title={t("editPrompt")}
            aria-label={t("editPrompt")}
            disabled={disabled}
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
          >
            <Pencil aria-hidden="true" size={14} />
          </button>
        )}
      </div>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          className="guide-flow-menu"
          role="menu"
          aria-label={t("documentFlow")}
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
              triggerRef.current?.focus();
              setOpen(false);

              return;
            } else if (
              event.key.length === 1 &&
              event.key !== " " &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.altKey
            ) {
              const matching = [...items.slice(index + 1), ...items.slice(0, index + 1)].find(
                (item) =>
                  item.textContent?.trim().toLowerCase().startsWith(event.key.toLowerCase()),
              );

              if (!matching) return;

              next = items.indexOf(matching);
            } else {
              return;
            }

            event.preventDefault();
            items[next]?.focus();
          }}
        >
          <div role="group" aria-label={t("documentFlow")}>
            {builtInFlows.map(renderOption)}
          </div>
          {customFlows.length > 0 && (
            <>
              <div className="guide-flow-separator" role="separator" />
              <div role="group" aria-labelledby={`${menuId}-custom`}>
                <div id={`${menuId}-custom`} className="guide-flow-group-label">
                  {t("customFlows")}
                </div>
                <div className="guide-flow-custom-list">{customFlows.map(renderOption)}</div>
              </div>
            </>
          )}
          <div className="guide-flow-separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="guide-flow-option guide-flow-add"
            onClick={() => choose("create")}
          >
            <Plus aria-hidden="true" size={16} />
            <span>{t("createFlowOption")}</span>
          </button>
        </div>
      )}
    </div>
  );
}
