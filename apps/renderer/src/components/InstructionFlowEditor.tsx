import { useEffect, useId, useRef } from "react";
import { Save, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { useInstructionFlows } from "../hooks/useInstructionFlows";
import { Button } from "./Button";
import { InstructionFlowGlyph } from "./InstructionFlowGlyph";
import { InstructionFlowIconSelect } from "./InstructionFlowIconSelect";

/** Shared dialog keeps default and custom editing behavior consistent in settings and the workspace. */
export function InstructionFlowEditor({
  flows,
}: {
  flows: ReturnType<typeof useInstructionFlows>;
}) {
  const t = useTranslations();
  const titleId = useId();
  const nameId = useId();
  const dialogRef = useRef<HTMLFormElement>(null);
  const open = flows.editor !== null;
  const { closeEditor } = flows;

  useEffect(() => {
    if (!open) return;
    const returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const dialog = dialogRef.current;

    dialog?.querySelector<HTMLElement>("input:not([readonly]), textarea")?.focus();

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeEditor();
      }

      if (event.key !== "Tab" || !dialog) return;
      const controls = dialog.querySelectorAll<HTMLElement>(
        ":is(input, textarea, button):not(:disabled)",
      );

      const first = controls[0];
      const last = controls[controls.length - 1];

      // A pending save disables every control; retain focus inside the modal until it finishes.
      if (!first || !last) {
        event.preventDefault();
        dialog.focus();

        return;
      }

      if (document.activeElement === dialog || !dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();

        return;
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, [open, closeEditor]);

  useEffect(() => {
    if (open && flows.isBusy) dialogRef.current?.focus();
  }, [open, flows.isBusy]);

  const editor = flows.editor;

  if (!editor) return null;

  return (
    <div
      className="modal-backdrop guide-instructions-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeEditor();
      }}
    >
      <form
        ref={dialogRef}
        className="guide-instructions-dialog prompt-editor-dialog"
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={flows.isBusy}
        onSubmit={(event) => {
          event.preventDefault();
          void flows.saveFlow();
        }}
      >
        <header className="prompt-editor-header">
          <InstructionFlowGlyph icon={editor.icon} aria-hidden="true" size={20} />
          <div>
            <h2 id={titleId}>{t(editor.editingId ? "guide.editPrompt" : "guide.newPrompt")}</h2>
            <p>{t(editor.isBuiltIn ? "guide.defaultPromptDescription" : "guide.customPrompt")}</p>
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            title={t("guide.closeEditor")}
            aria-label={t("guide.closeEditor")}
            disabled={flows.isBusy}
            onClick={closeEditor}
          >
            <X aria-hidden="true" size={18} />
          </Button>
        </header>
        <div className="prompt-editor-body">
          <div className="prompt-name-field">
            <label htmlFor={nameId}>{t("guide.promptName")}</label>
            <div className="prompt-name-control">
              <input
                id={nameId}
                value={editor.name}
                readOnly={editor.isBuiltIn}
                disabled={flows.isBusy}
                onChange={(event) => flows.renameDraft(event.target.value)}
                required
                maxLength={80}
                placeholder={t("guide.flowNamePlaceholder")}
              />
              <InstructionFlowIconSelect
                icon={editor.icon}
                disabled={flows.isBusy}
                onChange={flows.changeIcon}
              />
            </div>
          </div>
          <label className="prompt-instructions-field">
            <span className="prompt-field-heading">
              <span>{t("guide.instructionsLabel")}</span>
              <span className="prompt-character-count" aria-hidden="true">
                {editor.instructions.length.toLocaleString()} / 10,000
              </span>
            </span>
            <textarea
              aria-label={t("guide.instructionsLabel")}
              value={editor.instructions}
              spellCheck={false}
              required
              maxLength={10_000}
              disabled={flows.isBusy}
              onChange={(event) => flows.reviseInstructions(event.target.value)}
              placeholder={t("guide.instructionsPlaceholder")}
            />
          </label>
          {editor.error && (
            <p className="settings-inline-error" role="alert">
              {editor.error}
            </p>
          )}
        </div>
        <footer>
          {editor.editingId && !editor.isBuiltIn && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="guide-flow-delete"
              title={t("guide.deleteFlow")}
              aria-label={t("guide.deleteFlow")}
              disabled={flows.isBusy}
              onClick={() => void flows.deleteFlow()}
            >
              <Trash2 aria-hidden="true" size={15} />
            </Button>
          )}
          <Button type="button" variant="secondary" disabled={flows.isBusy} onClick={closeEditor}>
            {t("actions.cancel")}
          </Button>
          <Button type="submit" disabled={flows.isBusy}>
            <Save aria-hidden="true" size={14} />
            {t("guide.savePrompt")}
          </Button>
        </footer>
      </form>
    </div>
  );
}
