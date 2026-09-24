import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  RotateCcw,
  Save,
  Sparkles,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { GuideContextItem, RecordingSummary } from "@path/shared";
import { Button } from "@/components/Button";
import { GuideChatInput } from "./GuideChatInput";
import { InstructionFlowSelect } from "./InstructionFlowSelect";
import { InstructionFlowEditor } from "./InstructionFlowEditor";
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
  const [overwriteOpen, setOverwriteOpen] = useState(false);
  const flowSelectRef = useRef<HTMLButtonElement>(null);
  const error = guide.error ?? flows.error;
  const promptsReady = flows.loaded && !flows.isBusy;

  // The workspace keeps only the latest dirty flag and saver for its discard guard.
  useEffect(() => {
    onGuideStateChange?.({ isDirty, save: saveDocument });

    return () => onGuideStateChange?.(null);
  }, [isDirty, saveDocument, onGuideStateChange]);

  function requestGenerate(): void {
    if (!promptsReady) return;
    // Generating replaces the draft, so an existing document needs explicit confirmation.
    if (guide.markdown.trim()) {
      setOverwriteOpen(true);
    } else {
      void guide.generateGuide(flows.selectedFlow.instructions);
    }
  }

  function confirmGenerate(): void {
    if (!promptsReady) return;
    setOverwriteOpen(false);
    void guide.generateGuide(flows.selectedFlow.instructions);
  }

  async function updateGuide(prompt: string, context: GuideContextItem[]): Promise<boolean> {
    if (!promptsReady) return false;

    return guide.updateGuide(flows.selectedFlow.instructions, prompt, context);
  }

  function retryGenerate(): void {
    if (promptsReady) void guide.generateGuide(flows.selectedFlow.instructions);
  }

  let saveStatus = "";

  if (guide.saving) saveStatus = t("guide.saving");
  else if (isDirty) saveStatus = t("guide.unsaved");
  else if (guide.markdown) saveStatus = t("guide.saved");

  return (
    <>
      <aside className="guide-panel">
        <header className="pane-header">
          <div className="guide-title-row">
            <InstructionFlowSelect
              triggerRef={flowSelectRef}
              variant="title"
              selectedFlow={flows.selectedFlow}
              builtInFlows={flows.builtInFlows}
              customFlows={flows.customFlows}
              disabled={!flows.loaded || flows.isBusy || guide.generating || guide.updating}
              onSelect={flows.selectFlow}
            />
            <div className="guide-header-actions">
              <Button
                size="sm"
                disabled={!recording || guide.generating || guide.updating || !promptsReady}
                onClick={requestGenerate}
              >
                <Sparkles size={14} />
                {guide.generating ? t("guide.generating") : t("guide.generate")}
              </Button>
            </div>
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
              <GuideChatInput
                key={recording?.id}
                updating={guide.updating}
                disabled={guide.loading || guide.generating || !promptsReady}
                onSend={updateGuide}
              />
              <div className="markdown-editor-footer">
                <div className="markdown-footer-info">
                  {guide.versions.length > 0 ? (
                    <span className="guide-version-select">
                      <button
                        type="button"
                        className="guide-version-step"
                        title={t("guide.versionPrevious")}
                        aria-label={t("guide.versionPrevious")}
                        disabled={
                          guide.loading ||
                          guide.generating ||
                          guide.updating ||
                          (guide.atVersion && guide.activeVersion <= 0)
                        }
                        onClick={() =>
                          guide.selectVersion(
                            guide.atVersion ? guide.activeVersion - 1 : guide.activeVersion,
                          )
                        }
                      >
                        <ChevronLeft aria-hidden="true" size={14} />
                      </button>
                      <select
                        className="guide-version-menu"
                        aria-label={t("guide.versionLabel")}
                        disabled={guide.loading || guide.generating || guide.updating}
                        value={guide.atVersion ? guide.activeVersion : "edits"}
                        onChange={(event) => {
                          if (event.target.value !== "edits") {
                            guide.selectVersion(Number(event.target.value));
                          }
                        }}
                      >
                        {guide.versions.map((_, index) => (
                          <option key={index} value={index}>
                            {t("guide.versionOption", {
                              index: index + 1,
                              count: guide.versions.length,
                            })}
                          </option>
                        ))}
                        {!guide.atVersion && (
                          <option value="edits">{t("guide.versionEdits")}</option>
                        )}
                      </select>
                      <button
                        type="button"
                        className="guide-version-step"
                        title={t("guide.versionNext")}
                        aria-label={t("guide.versionNext")}
                        disabled={
                          guide.loading ||
                          guide.generating ||
                          guide.updating ||
                          !guide.atVersion ||
                          guide.activeVersion >= guide.versions.length - 1
                        }
                        onClick={() => guide.selectVersion(guide.activeVersion + 1)}
                      >
                        <ChevronRight aria-hidden="true" size={14} />
                      </button>
                    </span>
                  ) : (
                    <span className="guide-version-empty">{t("guide.noVersions")}</span>
                  )}
                  {saveStatus && (
                    <span className="markdown-save-status" role="status">
                      {saveStatus}
                    </span>
                  )}
                </div>
                <div className="markdown-editor-actions">
                  <Button
                    className="markdown-copy-action"
                    size="icon"
                    variant="ghost"
                    title={guide.copied ? t("guide.copied") : t("guide.copy")}
                    aria-label={guide.copied ? t("guide.copied") : t("guide.copy")}
                    disabled={!guide.markdown}
                    onClick={() => void guide.copyMarkdown()}
                  >
                    {guide.copied ? (
                      <Check aria-hidden="true" size={14} />
                    ) : (
                      <Copy aria-hidden="true" size={14} />
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!isDirty || guide.saving || guide.generating || guide.updating}
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
                  disabled={!promptsReady}
                  onClick={retryGenerate}
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
              <Button disabled={!promptsReady} onClick={confirmGenerate}>
                <Sparkles aria-hidden="true" size={14} />
                {t("guide.replace")}
              </Button>
            </footer>
          </div>
        </div>
      )}
      <InstructionFlowEditor flows={flows} />
    </>
  );
}
