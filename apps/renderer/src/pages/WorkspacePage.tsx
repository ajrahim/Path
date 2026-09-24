import { RENDERER_ROUTES, isActiveRecordingStatus } from "@path/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/router";
import { Button } from "@/components/Button";
import { GuidePane, type GuidePaneState } from "@/components/GuidePane";
import { HistorySidebar } from "@/components/HistorySidebar";
import { useRecordingHistory } from "@/hooks/useRecordingHistory";
import { RecordingPane } from "@/components/RecordingPane";
import { SourceDialog } from "@/components/SourceDialog";
import { useRecording } from "@/hooks/useRecording";
import { useTimelineImports } from "@/hooks/useTimelineImports";
import { getDesktopApi } from "@/lib/Desktop";
import { LocalModelSelect } from "@/components/LocalModelSelect";
import { WorkspaceWelcome } from "@/components/WorkspaceWelcome";
import type { TimelineTab } from "@/components/TimelineTabs";

export default function WorkspacePage() {
  const t = useTranslations();
  const router = useRouter();
  const { snapshot, refresh, rename } = useRecordingHistory();
  const { snapshot: recordingState } = useRecording();

  // Selection and panel sizes belong to this window; recording data is shared within its store.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sourceDialogOpen, setSourceDialogOpen] = useState(false);
  const [guideWidth, setGuideWidth] = useState(440);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [titleSaving, setTitleSaving] = useState(false);
  const isTitleSavingRef = useRef(false);
  const [titleError, setTitleError] = useState(false);
  const [timelineTab, setTimelineTab] = useState<TimelineTab>("activity");
  const [pendingSelectionId, setPendingSelectionId] = useState<string | null>(null);
  const [switchSaving, setSwitchSaving] = useState(false);
  const guideStateRef = useRef<GuidePaneState | null>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const discardDialogRef = useRef<HTMLDialogElement>(null);
  const recordingActive = isActiveRecordingStatus(recordingState.status);

  const handleGuideStateChange = useCallback((state: GuidePaneState | null) => {
    guideStateRef.current = state;
  }, []);

  const hasPendingRecordings = snapshot.recordings.some(
    (recording) => recording.status === "recording" || recording.status === "processing",
  );

  const activeSelectedId = selectedId ?? recordingState.recordingId;
  const selected =
    snapshot.recordings.find((recording) => recording.id === activeSelectedId) ?? null;

  const showWelcome = !selected && !recordingActive;

  // Owned above the status-keyed recording pane so an import started while the recording
  // processes, and the selected review tab, survive the remount when processing finishes.
  const timelineImports = useTimelineImports({
    recordingId: selected?.id ?? null,
    durationMs: selected?.durationMs ?? null,
  });

  let titleStatus = t("navigation.saved");

  if (titleSaving) titleStatus = t("navigation.saving");

  if (titleError) titleStatus = t("navigation.titleSaveFailed");

  useEffect(() => {
    void refresh();
  }, [recordingState.status, recordingState.recordingId, refresh]);

  useEffect(() => {
    if (!recordingActive && !hasPendingRecordings) return;

    const timer = setInterval(() => {
      void refresh();
    }, 1000);

    return () => clearInterval(timer);
  }, [recordingActive, hasPendingRecordings, refresh]);

  useEffect(() => {
    if (!pendingSelectionId) return;

    const dialog = discardDialogRef.current;

    dialog?.showModal();
    dialog?.querySelector<HTMLButtonElement>("[data-cancel-switch]")?.focus();

    return () => dialog?.close();
  }, [pendingSelectionId]);

  function requestSelect(id: string): void {
    if (id === activeSelectedId) return;

    // An unsaved guide draft belongs to the current recording; confirm before leaving it.
    if (guideStateRef.current?.isDirty) {
      setPendingSelectionId(id);

      return;
    }

    setSelectedId(id);
  }

  async function saveAndSwitch(): Promise<void> {
    if (!pendingSelectionId || switchSaving) return;

    setSwitchSaving(true);

    try {
      const saved = await guideStateRef.current?.save();

      // A failed save keeps the dialog open; the guide pane already shows the error.
      if (saved === false) return;

      setSelectedId(pendingSelectionId);
      setPendingSelectionId(null);
    } finally {
      setSwitchSaving(false);
    }
  }

  function discardAndSwitch(): void {
    if (!pendingSelectionId) return;

    setSelectedId(pendingSelectionId);
    setPendingSelectionId(null);
  }

  function openSettings(): void {
    const desktop = getDesktopApi();

    if (desktop) void desktop.app.openSettings();
    else void router.push(RENDERER_ROUTES.settings);
  }

  function resize(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.buttons !== 1) return;

    const right = workspaceRef.current?.getBoundingClientRect().right ?? window.innerWidth;

    setGuideWidth(clampGuideWidth(right - event.clientX));
  }

  function clampGuideWidth(width: number): number {
    // Match the CSS limit so dragging and keyboard resizing use the visible pane width.
    const availableWidth = workspaceRef.current?.clientWidth ?? window.innerWidth;
    const maximum = Math.max(340, Math.min(680, availableWidth - 301));

    return Math.min(maximum, Math.max(340, width));
  }

  function resizeWithKeyboard(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

    const direction = event.key === "ArrowLeft" ? -1 : 1;

    event.preventDefault();
    setGuideWidth((width) => clampGuideWidth(clampGuideWidth(width) - direction * 12));
  }

  async function saveTitle(element: HTMLElement): Promise<void> {
    if (!selected || isTitleSavingRef.current || snapshot.mutationRequestIds[selected.id]) return;

    const title = element.innerText.replace(/\s+/g, " ").trim().slice(0, 120);

    if (!title) {
      element.textContent = selected.title;

      return;
    }

    if (title === selected.title) return;

    // Blur can fire again before the disabled state renders, so lock the write immediately.
    isTitleSavingRef.current = true;
    setTitleSaving(true);
    setTitleError(false);

    try {
      await rename(selected.id, title);
    } catch {
      setTitleError(true);
    } finally {
      isTitleSavingRef.current = false;
      setTitleSaving(false);
    }
  }

  return (
    <div className="app-frame">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" />
          {t("app.name")}
          <span className="brand-divider" aria-hidden="true" />
          <button
            type="button"
            className="sidebar-toggle"
            aria-label={t("navigation.toggleSidebar")}
            title={t(sidebarVisible ? "navigation.hideSidebar" : "navigation.showSidebar")}
            aria-expanded={sidebarVisible}
            aria-controls="workspace-sidebar"
            onClick={() => setSidebarVisible((visible) => !visible)}
          >
            {sidebarVisible ? (
              <PanelLeftClose size={17} aria-hidden="true" />
            ) : (
              <PanelLeftOpen size={17} aria-hidden="true" />
            )}
          </button>
        </div>
        <div className="workspace-title">
          {selected ? (
            <strong
              key={`${selected.id}-${selected.title}`}
              className="workspace-title-editable"
              contentEditable={!titleSaving && !snapshot.mutationRequestIds[selected.id]}
              aria-disabled={titleSaving || Boolean(snapshot.mutationRequestIds[selected.id])}
              suppressContentEditableWarning
              role="textbox"
              aria-label={t("navigation.editTitle")}
              spellCheck={false}
              onBlur={(event) => void saveTitle(event.currentTarget)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                }

                if (event.key === "Escape") {
                  event.currentTarget.textContent = selected.title;
                  event.currentTarget.blur();
                }
              }}
            >
              {selected.title}
            </strong>
          ) : (
            <strong>{t("navigation.workspaceTitle")}</strong>
          )}
          {selected && (
            <span className={titleError ? "workspace-save-error" : undefined}>
              <Check size={12} />
              {titleStatus}
            </span>
          )}
        </div>
        <div className="header-actions">
          <LocalModelSelect disabled={recordingActive} />
        </div>
      </header>
      <div className={`workspace-grid${sidebarVisible ? "" : " workspace-sidebar-hidden"}`}>
        <div id="workspace-sidebar" className="workspace-sidebar" hidden={!sidebarVisible}>
          <HistorySidebar
            selectedId={activeSelectedId}
            onSelect={requestSelect}
            onDeleted={(id) => {
              if (id === activeSelectedId) setSelectedId(null);
            }}
            onNewRecording={() => setSourceDialogOpen(true)}
            onOpenSettings={openSettings}
          />
        </div>
        <div
          ref={workspaceRef}
          className={`recording-workspace${showWelcome ? " recording-workspace-empty" : ""}`}
          style={
            showWelcome
              ? undefined
              : {
                  gridTemplateColumns: `minmax(300px, 1fr) 1px clamp(340px, ${guideWidth}px, calc(100% - 301px))`,
                }
          }
        >
          {showWelcome ? (
            <WorkspaceWelcome onNewRecording={() => setSourceDialogOpen(true)} />
          ) : (
            <>
              <RecordingPane
                key={`recording-${selected?.id ?? "empty"}-${selected?.status ?? "none"}`}
                recording={selected}
                timelineTab={timelineTab}
                timelineImports={timelineImports}
                onTimelineTabChange={setTimelineTab}
                onNewRecording={() => setSourceDialogOpen(true)}
                onOpenSettings={openSettings}
              />
              <div
                className="resize-handle workspace-divider"
                role="separator"
                aria-label={t("actions.resizeGuide")}
                aria-orientation="vertical"
                tabIndex={0}
                onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
                onPointerMove={resize}
                onKeyDown={resizeWithKeyboard}
              />
              <GuidePane
                key={`guide-${selected?.id ?? "empty"}`}
                recording={selected}
                onGuideStateChange={handleGuideStateChange}
              />
            </>
          )}
        </div>
      </div>
      <SourceDialog
        key={sourceDialogOpen ? "open" : "closed"}
        open={sourceDialogOpen}
        onClose={() => setSourceDialogOpen(false)}
        onStarted={(recordingId) => {
          if (recordingId) requestSelect(recordingId);

          void refresh();
        }}
      />
      <dialog
        ref={discardDialogRef}
        className="recording-delete-dialog"
        aria-labelledby="guide-discard-title"
        aria-describedby="guide-discard-description"
        onCancel={(event) => {
          event.preventDefault();
          if (!switchSaving) setPendingSelectionId(null);
        }}
      >
        <h2 id="guide-discard-title">{t("guide.discardTitle")}</h2>
        <p id="guide-discard-description">{t("guide.discardDescription")}</p>
        <footer>
          <Button
            data-cancel-switch
            variant="secondary"
            disabled={switchSaving}
            onClick={() => setPendingSelectionId(null)}
          >
            {t("actions.cancel")}
          </Button>
          <Button variant="ghost" disabled={switchSaving} onClick={discardAndSwitch}>
            {t("guide.discard")}
          </Button>
          <Button disabled={switchSaving} onClick={() => void saveAndSwitch()}>
            {switchSaving ? t("guide.saving") : t("guide.saveAndSwitch")}
          </Button>
        </footer>
      </dialog>
    </div>
  );
}
