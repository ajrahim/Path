import { useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  Download,
  GitCompare,
  History,
  RotateCcw,
  Save,
  Sparkles,
} from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import type { GuideContextItem, RecordingSummary } from "@path/shared";
import { Button } from "@/components/Button";
import { GuideChatInput } from "./GuideChatInput";
import { GuideRevisionCompare } from "./GuideRevisionCompare";
import { GuideVersionSelect } from "./GuideVersionSelect";
import { InstructionFlowSelect } from "./InstructionFlowSelect";
import { InstructionFlowEditor } from "./InstructionFlowEditor";
import { useInstructionFlows } from "../hooks/useInstructionFlows";
import { useGuideDocument } from "../hooks/useGuideDocument";

export interface GuidePaneState {
  isDirty: boolean;
  save(): Promise<boolean>;
  /** Drops unsaved text durably so its recovery draft does not return. */
  discard(): Promise<boolean>;
}

export function GuidePane({
  recording,
  onGuideStateChange,
}: {
  recording: RecordingSummary | null;
  onGuideStateChange?(state: GuidePaneState | null): void;
}) {
  const t = useTranslations();
  const format = useFormatter();
  // "Last saved 5 minutes ago" stays current while the pane is open.
  const now = useNow({ updateInterval: 60_000 });
  const flows = useInstructionFlows();
  const { markdownInputRef, isDirty, saveDocument, discardChanges, ...guide } =
    useGuideDocument(recording);

  const [overwriteOpen, setOverwriteOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const flowSelectRef = useRef<HTMLButtonElement>(null);
  const error = guide.error ?? flows.error;
  const promptsReady = flows.loaded && !flows.isBusy;

  const preview = guide.preview;
  const isBusy = guide.loading || guide.generating || guide.updating || guide.restoring;
  // The editor shows a previewed version, or the version its current text came from.
  const shownNumber = preview?.number ?? guide.currentRevisionNumber;

  // The workspace keeps only the latest dirty flag and handlers for its discard guard.
  useEffect(() => {
    onGuideStateChange?.({ isDirty, save: saveDocument, discard: discardChanges });

    return () => onGuideStateChange?.(null);
  }, [isDirty, saveDocument, discardChanges, onGuideStateChange]);

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

  async function updateGuide(
    prompt: string,
    context: GuideContextItem[],
    contextFolder?: string,
  ): Promise<boolean> {
    if (!promptsReady) return false;

    return guide.updateGuide(flows.selectedFlow.instructions, prompt, context, contextFolder);
  }

  function retryGenerate(): void {
    if (promptsReady) void guide.generateGuide(flows.selectedFlow.instructions);
  }

  // Recovery drafts never read as saved: the time shown is the last explicit, committed save.
  function saveStatusText(): string {
    if (guide.saving) return t("guide.saving");

    const lastSaved = guide.savedAt ? format.relativeTime(new Date(guide.savedAt), now) : null;

    if (!isDirty) return lastSaved ? t("guide.lastSaved", { time: lastSaved }) : "";
    if (guide.draftStatus === "failed" || guide.draftStatus === "conflict") {
      return t("guide.draftNotKept");
    }

    if (guide.isRecoveredDraft) return t("guide.draftRecovered");

    return lastSaved ? t("guide.unsavedLastSaved", { time: lastSaved }) : t("guide.unsaved");
  }

  /** Choosing the version the editor text came from returns to editing it. */
  function showRevision(number: number | null): void {
    const isCurrent = number === null || number === guide.currentRevisionNumber;

    void guide.previewRevision(isCurrent ? null : number);
  }

  const saveStatus = saveStatusText();

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

            if (images.length === 0 || preview) return;

            event.preventDefault();
            void guide.insertImages(images);
          }}
        >
          {recording ? (
            <>
              {preview && (
                <div className="guide-preview-bar" role="status">
                  <span>{t("guide.previewing", { number: preview.number })}</span>
                  <div className="guide-preview-actions">
                    <Button size="sm" variant="ghost" onClick={() => setCompareOpen(true)}>
                      <GitCompare aria-hidden="true" size={13} />
                      {t("guide.compare")}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={isBusy}
                      onClick={() => void guide.restoreRevision(preview.number)}
                    >
                      <History aria-hidden="true" size={13} />
                      {guide.restoring ? t("guide.restoring") : t("guide.restore")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={guide.restoring}
                      onClick={() => void guide.previewRevision(null)}
                    >
                      {t("guide.backToCurrent")}
                    </Button>
                  </div>
                </div>
              )}
              <textarea
                ref={markdownInputRef}
                className={preview ? "guide-previewing" : undefined}
                value={preview?.markdown ?? guide.markdown}
                readOnly={preview !== null}
                disabled={guide.loading}
                onChange={(event) => guide.editMarkdown(event.target.value)}
                onPaste={(event) => {
                  const images = [...event.clipboardData.files].filter((file) =>
                    file.type.startsWith("image/"),
                  );

                  if (images.length === 0 || preview) return;

                  event.preventDefault();
                  void guide.insertImages(images);
                }}
                aria-label={t("guide.editor")}
                placeholder={t("guide.markdownPlaceholder")}
              />
              <GuideChatInput
                key={recording?.id}
                updating={guide.updating}
                disabled={
                  guide.loading || guide.generating || guide.restoring || !promptsReady || !!preview
                }
                onSend={updateGuide}
              />
              <div className="markdown-editor-footer">
                <div className="markdown-footer-info">
                  {guide.revisions.length > 0 ? (
                    <GuideVersionSelect
                      revisions={guide.revisions}
                      hasOlderRevisions={guide.hasOlderRevisions}
                      shownNumber={shownNumber}
                      currentNumber={guide.currentRevisionNumber}
                      savedNumber={guide.savedRevisionNumber}
                      disabled={isBusy}
                      onSelect={showRevision}
                      onLoadOlder={() => void guide.loadOlderRevisions()}
                    />
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
                    disabled={!isDirty || guide.saving || isBusy || !!preview}
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
          {guide.notice && !error && (
            <p className="markdown-image-error guide-notice" role="status">
              <span>{guide.notice}</span>
            </p>
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
      {compareOpen && preview && (
        <GuideRevisionCompare
          revisionNumber={preview.number}
          revisionMarkdown={preview.markdown}
          currentMarkdown={guide.markdown}
          onClose={() => setCompareOpen(false)}
        />
      )}
      <InstructionFlowEditor flows={flows} />
    </>
  );
}
