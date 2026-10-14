import { useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  Download,
  GitCompare,
  Hammer,
  History,
  LoaderCircle,
  RotateCcw,
  Save,
  Sparkles,
} from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import type { DocumentGenerationMode, GuideContextItem, RecordingSummary } from "@path/shared";
import { Button } from "./Button";
import { GuideChatInput } from "./GuideChatInput";
import { GuideDeployRow } from "./GuideDeployRow";
import { GuideDiscardDialog } from "./GuideDiscardDialog";
import { GuideDocumentModeSwitch } from "./GuideDocumentModeSwitch";
import { GuideDocumentStructure } from "./GuideDocumentStructure";
import { GuideRevisionCompare } from "./GuideRevisionCompare";
import { GuideVersionSelect } from "./GuideVersionSelect";
import { InstructionFlowSelect } from "./InstructionFlowSelect";
import { InstructionFlowEditor } from "./InstructionFlowEditor";
import { useInstructionFlows } from "../hooks/useInstructionFlows";
import { useGuideDocument } from "../hooks/useGuideDocument";
import { useGuideCollection } from "../hooks/useGuideCollection";

export interface GuidePaneState {
  isDirty: boolean;
  save(): Promise<boolean>;
  /** Drops unsaved text durably so its recovery draft does not return. */
  discard(): Promise<boolean>;
}

/** A tab, workflow, or mode switch waiting on the dirty editor's save-or-discard answer. */
type PendingDocumentSwitch =
  | { type: "select"; id: string }
  | { type: "remove"; id: string }
  | { type: "mode"; mode: DocumentGenerationMode };

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
  const collection = useGuideCollection(
    recording?.id,
    flows.loaded && !flows.isBusy ? flows.selectedFlow.instructions : undefined,
  );

  const { markdownInputRef, isDirty, saveDocument, discardChanges, ...guide } = useGuideDocument(
    recording,
    collection.activeDocument,
  );

  const [isOverwriteOpen, setIsOverwriteOpen] = useState(false);
  const [isCompareOpen, setIsCompareOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingDocumentSwitch | null>(null);

  const [isSwitchSaving, setIsSwitchSaving] = useState(false);
  const discardDialogRef = useRef<HTMLDialogElement>(null);
  const flowSelectRef = useRef<HTMLButtonElement>(null);
  const error = guide.error ?? collection.error ?? flows.error;
  const promptsReady = flows.loaded && !flows.isBusy;
  const isEmptySplit = collection.activeDocument === null;
  const isEmptyPlan = collection.mode === "split" && !collection.workflows?.length;
  const isSplitTabPanel = collection.mode === "split" && collection.activeDocumentId !== null;

  const preview = guide.preview;
  const isBusy =
    collection.loading ||
    collection.pending ||
    guide.loading ||
    guide.generating ||
    guide.updating ||
    guide.restoring ||
    isSwitchSaving;

  // The editor shows a previewed version, or the version its current text came from.
  const shownNumber = preview?.number ?? guide.currentRevisionNumber;

  // The workspace keeps only the latest dirty flag and handlers for its discard guard.
  useEffect(() => {
    onGuideStateChange?.({ isDirty, save: saveDocument, discard: discardChanges });

    return () => onGuideStateChange?.(null);
  }, [isDirty, saveDocument, discardChanges, onGuideStateChange]);

  useEffect(() => {
    if (!pendingAction) return;
    const dialog = discardDialogRef.current;

    dialog?.showModal();
    dialog?.querySelector<HTMLButtonElement>("[data-cancel-switch]")?.focus();

    return () => dialog?.close();
  }, [pendingAction]);

  function generateDocuments(): void {
    if (!promptsReady || isBusy) return;
    void guide.generateGuide(flows.selectedFlow.instructions, {
      mode: collection.mode,
      onGenerated: collection.adoptCollection,
    });
  }

  function requestDocument(id: string): void {
    if (isBusy || id === collection.activeDocumentId) return;
    if (isDirty) {
      setPendingAction({ type: "select", id });

      return;
    }

    collection.selectDocument(id);
  }

  function requestMode(mode: DocumentGenerationMode): void {
    // Re-selecting split with no plan retries the failed workflow suggestions.
    const canRetrySuggestions = mode === "split" && collection.workflows === null;
    const alreadyInMode = mode === collection.mode && !canRetrySuggestions;

    if (isBusy || alreadyInMode) return;

    const nextWorkflow =
      collection.workflows?.find((workflow) => workflow.id === collection.activeDocumentId) ??
      collection.workflows?.[0];

    const nextDocumentId =
      mode === "combine" ? collection.activeDocument?.id : nextWorkflow?.documentId;

    if (isDirty && nextDocumentId !== collection.activeDocument?.id) {
      setPendingAction({ type: "mode", mode });
    } else {
      void collection.setMode(mode, flows.selectedFlow.instructions);
    }
  }

  function removeWorkflow(id: string): void {
    if (isBusy) return;

    if (id === collection.activeDocumentId && isDirty) setPendingAction({ type: "remove", id });
    else void collection.removeWorkflow(id);
  }

  /** Returns whether the switch completed; a failed workflow removal keeps the dialog open. */
  async function applyPendingAction(action: PendingDocumentSwitch): Promise<boolean> {
    switch (action.type) {
      case "select":
        collection.selectDocument(action.id);

        return true;
      case "remove":
        return collection.removeWorkflow(action.id);
      case "mode":
        await collection.setMode(action.mode, flows.selectedFlow.instructions);

        return true;
    }
  }

  async function switchDocument(shouldSave: boolean): Promise<void> {
    if (!pendingAction || isSwitchSaving) return;

    setIsSwitchSaving(true);
    try {
      const hasResolvedChanges = await (shouldSave ? saveDocument() : discardChanges());

      if (!hasResolvedChanges || !(await applyPendingAction(pendingAction))) return;

      setPendingAction(null);
    } finally {
      setIsSwitchSaving(false);
    }
  }

  function requestGenerate(): void {
    if (!promptsReady || isBusy) return;
    // Generating replaces the draft, so an existing document needs explicit confirmation.
    if (guide.markdown.trim() || collection.documents.length > 0) {
      setIsOverwriteOpen(true);
    } else {
      generateDocuments();
    }
  }

  function confirmGenerate(): void {
    if (!promptsReady) return;
    setIsOverwriteOpen(false);
    generateDocuments();
  }

  async function updateGuide(
    prompt: string,
    context: GuideContextItem[],
    contextFolder?: string,
  ): Promise<boolean> {
    if (!promptsReady) return false;

    return guide.updateGuide(flows.selectedFlow.instructions, prompt, context, contextFolder);
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

  function editorPlaceholder(): string {
    if (collection.pending && collection.mode === "split" && collection.workflows === null) {
      return t("guide.suggestingSplits");
    }

    if (isEmptySplit) return t(isEmptyPlan ? "guide.noSplits" : "guide.notGenerated");

    return t("guide.markdownPlaceholder");
  }

  function overwriteTitleKey(): string {
    return collection.documents.length > 1
      ? "guide.overwriteCollectionTitle"
      : "guide.overwriteTitle";
  }

  function overwriteDescriptionKey(): string {
    if (collection.mode === "split") return "guide.overwriteSplitDescription";
    if (collection.documents.length > 1) return "guide.overwriteCollectionDescription";

    return "guide.overwriteDescription";
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
              <GuideDocumentModeSwitch
                mode={collection.mode}
                disabled={!recording || isBusy || !promptsReady}
                onModeChange={requestMode}
              />
              <Button
                size="icon"
                className="guide-generate-button"
                aria-label={guide.generating ? t("guide.generating") : t("guide.generate")}
                title={guide.generating ? t("guide.generating") : t("guide.generate")}
                aria-busy={guide.generating}
                disabled={!recording || isBusy || !promptsReady}
                onClick={requestGenerate}
              >
                {guide.generating ? (
                  <LoaderCircle size={15} className="guide-chat-spinner" aria-hidden="true" />
                ) : (
                  <Hammer size={15} aria-hidden="true" />
                )}
              </Button>
            </div>
          </div>
          {collection.mode === "split" && (
            <GuideDocumentStructure
              key={`${recording?.id ?? ""}:${collection.mode}`}
              mode={collection.mode}
              workflows={collection.workflows ?? []}
              activeDocumentId={collection.activeDocumentId}
              disabled={!recording || isBusy || !promptsReady}
              onSelect={requestDocument}
              onAdd={collection.addWorkflow}
              onRemove={removeWorkflow}
              onRename={collection.renameWorkflow}
              onReorder={collection.moveWorkflow}
            />
          )}
        </header>
        <div
          id="guide-document-editor"
          role={isSplitTabPanel ? "tabpanel" : undefined}
          aria-labelledby={
            isSplitTabPanel ? `guide-document-${collection.activeDocumentId}` : undefined
          }
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

            if (images.length === 0 || preview || isBusy || isEmptySplit) return;

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
                    <Button size="sm" variant="ghost" onClick={() => setIsCompareOpen(true)}>
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
                disabled={
                  guide.loading ||
                  collection.loading ||
                  collection.pending ||
                  guide.generating ||
                  isSwitchSaving ||
                  isEmptySplit
                }
                onChange={(event) => guide.editMarkdown(event.target.value)}
                onPaste={(event) => {
                  const images = [...event.clipboardData.files].filter((file) =>
                    file.type.startsWith("image/"),
                  );

                  if (images.length === 0 || preview || isEmptySplit) return;

                  event.preventDefault();
                  void guide.insertImages(images);
                }}
                aria-label={t("guide.editor")}
                placeholder={editorPlaceholder()}
              />
              <GuideChatInput
                key={`${recording.id}-${collection.activeDocumentId ?? "empty"}`}
                updating={guide.updating}
                disabled={isBusy || isEmptySplit || !promptsReady || !!preview}
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
              {flows.selectedFlow.id !== "help-guide" && (
                <GuideDeployRow
                  key={`deploy-${recording.id}-${collection.activeDocumentId ?? "empty"}`}
                  markdown={guide.markdown}
                  disabled={isBusy || !!preview}
                />
              )}
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
                  disabled={!promptsReady || isBusy}
                  onClick={generateDocuments}
                >
                  <RotateCcw aria-hidden="true" size={12} />
                  {t("guide.retry")}
                </button>
              )}
              {collection.mode === "split" && collection.workflows === null && (
                <button
                  type="button"
                  className="markdown-error-retry"
                  disabled={!promptsReady || isBusy}
                  onClick={() => requestMode("split")}
                >
                  <RotateCcw aria-hidden="true" size={12} />
                  {t("guide.retrySuggestions")}
                </button>
              )}
            </p>
          )}
        </div>
      </aside>
      {isOverwriteOpen && (
        <div
          className="modal-backdrop guide-instructions-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsOverwriteOpen(false);
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
                <h2 id="guide-overwrite-title">{t(overwriteTitleKey())}</h2>
                <p>{t(overwriteDescriptionKey())}</p>
              </div>
            </header>
            <footer>
              <Button variant="secondary" onClick={() => setIsOverwriteOpen(false)}>
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
      {isCompareOpen && preview && (
        <GuideRevisionCompare
          revisionNumber={preview.number}
          revisionMarkdown={preview.markdown}
          currentMarkdown={guide.markdown}
          onClose={() => setIsCompareOpen(false)}
        />
      )}
      <InstructionFlowEditor flows={flows} />
      <GuideDiscardDialog
        dialogRef={discardDialogRef}
        isBusy={isSwitchSaving}
        title={t("guide.documentDiscardTitle")}
        description={t("guide.documentDiscardDescription")}
        onCancel={() => setPendingAction(null)}
        onDiscard={() => void switchDocument(false)}
        onSave={() => void switchDocument(true)}
      />
    </>
  );
}
