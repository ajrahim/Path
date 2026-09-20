import { useEffect, useRef, useState } from "react";
import {
  Copy,
  Download,
  Eye,
  ImagePlus,
  Pencil,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { RecordingSummary } from "@path/shared";
import { Button } from "@/components/Button";
import { renderMarkdownToHtml } from "@/lib/RenderMarkdown";
import { InstructionFlowSelect } from "./InstructionFlowSelect";
import { useInstructionFlows } from "../hooks/useInstructionFlows";
import { useGuideDocument } from "../hooks/useGuideDocument";

export interface GuidePaneState {
  isDirty: boolean;
  save(): Promise<boolean>;
}

export function GuidePane({
  recording,
  onGuideStateChange,
}: {
  recording: RecordingSummary | null;
  onGuideStateChange?(state: GuidePaneState | null): void;
}) {
  const t = useTranslations();
  const flows = useInstructionFlows();
  const { markdownInputRef, isDirty, saveDocument, ...guide } = useGuideDocument(recording);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [overwriteOpen, setOverwriteOpen] = useState(false);
  const flowSelectRef = useRef<HTMLButtonElement>(null);
  const flowNameRef = useRef<HTMLInputElement>(null);
  const flowDialogRef = useRef<HTMLFormElement>(null);
  const instructionsOpen = flows.editor !== null;
  const error = guide.error ?? flows.error;
  const { closeEditor } = flows;

  // The workspace keeps only the latest dirty flag and saver for its discard guard.
  useEffect(() => {
    onGuideStateChange?.({ isDirty, save: saveDocument });

    return () => onGuideStateChange?.(null);
  }, [isDirty, saveDocument, onGuideStateChange]);

  useEffect(() => {
    if (!instructionsOpen) return;

    // Keep focus inside the editor until it closes, then return it to the flow chooser.
    const returnFocus = flowSelectRef.current;

    flowNameRef.current?.focus();

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeEditor();
      }

      if (event.key === "Tab") {
        const controls = flowDialogRef.current?.querySelectorAll<HTMLElement>(
          "input, textarea, button:not(:disabled)",
        );

        const first = controls?.[0];
        const last = controls?.[controls.length - 1];

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }

    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      returnFocus?.focus();
    };
  }, [instructionsOpen, closeEditor]);

  function requestGenerate(): void {
    // Generating replaces the draft, so an existing document needs explicit confirmation.
    if (guide.markdown.trim()) {
      setOverwriteOpen(true);
    } else {
      void guide.generateGuide(flows.selectedFlow.instructions);
    }
  }

  function confirmGenerate(): void {
    setOverwriteOpen(false);
    void guide.generateGuide(flows.selectedFlow.instructions);
  }

  let saveStatus = "";

  if (guide.saving) saveStatus = t("guide.saving");
  else if (isDirty) saveStatus = t("guide.unsaved");
  else if (guide.markdown) saveStatus = t("guide.saved");

  return (
    <>
      <aside className="guide-panel">
        <header className="pane-header">
          <InstructionFlowSelect
            triggerRef={flowSelectRef}
            selectedFlow={flows.selectedFlow}
            customFlows={flows.customFlows}
            disabled={!flows.loaded || guide.generating}
            onSelect={flows.selectFlow}
          />
          <div className="guide-header-actions">
            <Button
              size="icon"
              variant="secondary"
              title={t("guide.editPrompt")}
              aria-label={t("guide.editPrompt")}
              disabled={!flows.loaded || guide.generating}
              onClick={flows.editSelectedFlow}
            >
              <Pencil aria-hidden="true" size={14} />
            </Button>
            <Button
              size="sm"
              disabled={!recording || guide.generating || !flows.loaded}
              onClick={requestGenerate}
            >
              <Sparkles size={14} />
              {guide.generating ? t("guide.generating") : t("guide.generate")}
            </Button>
          </div>
        </header>
        <div
          className="editor-surface markdown-editor-surface"
          onDragOver={(event) => {
            if (
              [...event.dataTransfer.items].some(
                (item) => item.kind === "file" && item.type.startsWith("image/"),
              )
            ) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }
          }}
          onDrop={(event) => {
            const images = [...event.dataTransfer.files].filter((file) =>
              file.type.startsWith("image/"),
            );

            if (images.length === 0) return;

            event.preventDefault();
            void guide.insertImages(images);
          }}
        >
          {recording ? (
            <>
              <div className="markdown-mode-toggle" role="group" aria-label={t("guide.editor")}>
                <button
                  type="button"
                  aria-pressed={mode === "edit"}
                  className={mode === "edit" ? "markdown-mode-active" : undefined}
                  onClick={() => setMode("edit")}
                >
                  <Pencil aria-hidden="true" size={13} />
                  {t("guide.editor")}
                </button>
                <button
                  type="button"
                  aria-pressed={mode === "preview"}
                  className={mode === "preview" ? "markdown-mode-active" : undefined}
                  onClick={() => setMode("preview")}
                >
                  <Eye aria-hidden="true" size={13} />
                  {t("guide.preview")}
                </button>
                {saveStatus && <span className="markdown-save-status">{saveStatus}</span>}
              </div>
              {mode === "edit" ? (
                <textarea
                  ref={markdownInputRef}
                  value={guide.markdown}
                  disabled={guide.loading}
                  onChange={(event) => guide.editMarkdown(event.target.value)}
                  onPaste={(event) => {
                    const images = [...event.clipboardData.files].filter((file) =>
                      file.type.startsWith("image/"),
                    );

                    if (images.length === 0) return;

                    event.preventDefault();
                    void guide.insertImages(images);
                  }}
                  aria-label={t("guide.editor")}
                  placeholder={t("guide.markdownPlaceholder")}
                />
              ) : (
                <div
                  className="markdown-preview"
                  aria-label={t("guide.preview")}
                  dangerouslySetInnerHTML={{
                    __html: guide.markdown.trim()
                      ? renderMarkdownToHtml(guide.markdown)
                      : `<p class="markdown-preview-empty">${t("guide.previewEmpty")}</p>`,
                  }}
                />
              )}
              <div className="markdown-editor-footer">
                <span className="markdown-image-hint">
                  <ImagePlus aria-hidden="true" size={13} />
                  {t("guide.imageHint")}
                </span>
                <div className="markdown-editor-actions">
                  <Button
                    className="markdown-copy-action"
                    size="icon"
                    variant="secondary"
                    title={guide.copied ? t("guide.copied") : t("guide.copy")}
                    aria-label={guide.copied ? t("guide.copied") : t("guide.copy")}
                    disabled={!guide.markdown}
                    onClick={() => void guide.copyMarkdown()}
                  >
                    <Copy aria-hidden="true" size={14} />
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!isDirty || guide.saving || guide.generating}
                    onClick={() => void saveDocument()}
                  >
                    <Save size={13} />
                    {guide.saving ? t("guide.saving") : t("guide.save")}
                  </Button>
                  <Button
                    size="sm"
                    disabled={!guide.markdown || guide.exporting}
                    onClick={() => void guide.exportMarkdown()}
                  >
                    <Download size={13} />
                    {guide.exporting ? t("guide.exporting") : t("guide.export")}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="guide-empty-state">
              <span>
                <Sparkles aria-hidden="true" size={18} />
              </span>
              <strong>{t("guide.emptyTitle")}</strong>
              <p>{flows.selectedFlow.name}</p>
            </div>
          )}
          {error && (
            <p className="markdown-image-error" role="alert">
              <span>{error}</span>
              {guide.canRetryGenerate && (
                <button
                  type="button"
                  className="markdown-error-retry"
                  onClick={() => void guide.generateGuide(flows.selectedFlow.instructions)}
                >
                  <RotateCcw aria-hidden="true" size={12} />
                  {t("guide.retry")}
                </button>
              )}
            </p>
          )}
        </div>
      </aside>
      {overwriteOpen && (
        <div
          className="modal-backdrop guide-instructions-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOverwriteOpen(false);
          }}
        >
          <div
            className="guide-instructions-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="guide-overwrite-title"
          >
            <header className="prompt-editor-header">
              <Sparkles aria-hidden="true" size={20} />
              <div>
                <h2 id="guide-overwrite-title">{t("guide.overwriteTitle")}</h2>
                <p>{t("guide.overwriteDescription")}</p>
              </div>
            </header>
            <footer>
              <Button variant="secondary" onClick={() => setOverwriteOpen(false)}>
                {t("actions.cancel")}
              </Button>
              <Button onClick={confirmGenerate}>
                <Sparkles aria-hidden="true" size={14} />
                {t("guide.replace")}
              </Button>
            </footer>
          </div>
        </div>
      )}
      {flows.editor && (
        <div
          className="modal-backdrop guide-instructions-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              flows.closeEditor();
            }
          }}
        >
          <form
            ref={flowDialogRef}
            className="guide-instructions-dialog prompt-editor-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="guide-instructions-title"
            onSubmit={(event) => {
              event.preventDefault();
              flows.saveFlow();
            }}
          >
            <header className="prompt-editor-header">
              <Pencil aria-hidden="true" size={20} />
              <div>
                <h2 id="guide-instructions-title">
                  {flows.editor.editingId || flows.editor.mode === "copy"
                    ? t("guide.editPrompt")
                    : t("guide.newPrompt")}
                </h2>
                <p>
                  {flows.editor.mode === "copy" ? t("guide.presetCopy") : t("guide.customPrompt")}
                </p>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                title={t("guide.closeEditor")}
                aria-label={t("guide.closeEditor")}
                onClick={() => flows.closeEditor()}
              >
                <X aria-hidden="true" size={18} />
              </Button>
            </header>
            <div className="prompt-editor-body">
              <label className="prompt-name-field">
                <span>{t("guide.promptName")}</span>
                <input
                  ref={flowNameRef}
                  value={flows.editor.name}
                  onChange={(event) => flows.renameDraft(event.target.value)}
                  required
                  maxLength={80}
                  placeholder={t("guide.flowNamePlaceholder")}
                />
              </label>
              <label className="prompt-instructions-field">
                <span className="prompt-field-heading">
                  <span>{t("guide.instructionsLabel")}</span>
                  <span className="prompt-character-count" aria-hidden="true">
                    {flows.editor.instructions.length.toLocaleString()} / 10,000
                  </span>
                </span>
                <textarea
                  aria-label={t("guide.instructionsLabel")}
                  value={flows.editor.instructions}
                  spellCheck={false}
                  required
                  maxLength={10_000}
                  onChange={(event) => flows.reviseInstructions(event.target.value)}
                  placeholder={t("guide.instructionsPlaceholder")}
                />
              </label>
              {flows.editor.error && (
                <p className="settings-inline-error" role="alert">
                  {flows.editor.error}
                </p>
              )}
            </div>
            <footer>
              {flows.editor.editingId && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="guide-flow-delete"
                  title={t("guide.deleteFlow")}
                  aria-label={t("guide.deleteFlow")}
                  onClick={flows.deleteFlow}
                >
                  <Trash2 aria-hidden="true" size={15} />
                </Button>
              )}
              <Button type="button" variant="secondary" onClick={() => flows.closeEditor()}>
                {t("actions.cancel")}
              </Button>
              <Button type="submit">
                {flows.editor.mode === "copy" ? (
                  <Copy aria-hidden="true" size={14} />
                ) : (
                  <Save aria-hidden="true" size={14} />
                )}
                {flows.editor.mode === "copy" ? t("guide.saveCopy") : t("guide.savePrompt")}
              </Button>
            </footer>
          </form>
        </div>
      )}
    </>
  );
}
