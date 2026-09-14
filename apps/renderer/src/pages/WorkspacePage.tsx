import { RENDERER_ROUTES } from "@path/shared";
import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/router";
import { GuidePane } from "@/components/GuidePane";
import { HistorySidebar } from "@/components/HistorySidebar";
import { useRecordingHistory } from "@/hooks/useRecordingHistory";
import { RecordingPane } from "@/components/RecordingPane";
import { SourceDialog } from "@/components/SourceDialog";
import { useRecording } from "@/hooks/useRecording";
import { getDesktopApi } from "@/lib/Desktop";
import { LocalModelSelect } from "@/components/LocalModelSelect";
import { ThemeToggle } from "@/components/ThemeToggle";

type DragTarget = "history" | "guide";

export default function WorkspacePage() {
  const t = useTranslations();
  const router = useRouter();
  const { snapshot, refresh, rename } = useRecordingHistory();
  const { snapshot: recordingState } = useRecording();

  // Selection and panel sizes belong to this window; recording data is shared within its store.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sourceDialogOpen, setSourceDialogOpen] = useState(false);
  const [historyWidth, setHistoryWidth] = useState(264);
  const [guideWidth, setGuideWidth] = useState(440);
  const [titleSaving, setTitleSaving] = useState(false);
  const isTitleSavingRef = useRef(false);
  const [titleError, setTitleError] = useState(false);
  const recordingActive = ["preparing", "recording", "stopping", "processing"].includes(
    recordingState.status,
  );

  const selected = snapshot.recordings.find((recording) => recording.id === selectedId) ?? null;
  let titleStatus = t("navigation.saved");

  if (titleSaving) titleStatus = t("navigation.saving");

  if (titleError) titleStatus = t("navigation.titleSaveFailed");

  useEffect(() => {
    if (recordingState.status === "ready") void refresh();
  }, [recordingState.status, refresh]);

  function resize(event: React.PointerEvent<HTMLDivElement>, target: DragTarget): void {
    if (event.buttons !== 1) return;

    if (target === "history") {
      setHistoryWidth(Math.min(380, Math.max(230, event.clientX - 8)));
    } else {
      setGuideWidth(Math.min(680, Math.max(410, window.innerWidth - event.clientX - 8)));
    }
  }

  function resizeWithKeyboard(
    event: React.KeyboardEvent<HTMLDivElement>,
    target: DragTarget,
  ): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

    const direction = event.key === "ArrowLeft" ? -1 : 1;

    event.preventDefault();
    if (target === "history") {
      setHistoryWidth((width) => Math.min(380, Math.max(230, width + direction * 12)));
    } else {
      setGuideWidth((width) => Math.min(680, Math.max(410, width - direction * 12)));
    }
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
          <span className={titleError ? "workspace-save-error" : undefined}>
            <Check size={12} />
            {titleStatus}
          </span>
        </div>
        <div className="header-actions">
          <LocalModelSelect disabled={recordingActive} />
          <span className="header-action-divider" aria-hidden="true" />
          <ThemeToggle />
        </div>
      </header>
      <div
        className="workspace-grid"
        style={{
          gridTemplateColumns: `${historyWidth}px 8px minmax(300px, 1fr) 8px ${guideWidth}px`,
        }}
      >
        <HistorySidebar
          selectedId={selectedId}
          onSelect={setSelectedId}
          onDeleted={(id) => {
            if (id === selectedId) setSelectedId(null);
          }}
          onNewRecording={() => setSourceDialogOpen(true)}
          onOpenSettings={() => {
            const desktop = getDesktopApi();

            if (desktop) void desktop.app.openSettings();
            else void router.push(RENDERER_ROUTES.settings);
          }}
        />
        <div
          className="resize-handle"
          role="separator"
          aria-label={t("actions.resizeHistory")}
          aria-orientation="vertical"
          tabIndex={0}
          onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
          onPointerMove={(event) => resize(event, "history")}
          onKeyDown={(event) => resizeWithKeyboard(event, "history")}
        />
        <RecordingPane
          key={`recording-${selected?.id ?? "empty"}-${selected?.status ?? "none"}`}
          recording={selected}
        />
        <div
          className="resize-handle"
          role="separator"
          aria-label={t("actions.resizeGuide")}
          aria-orientation="vertical"
          tabIndex={0}
          onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
          onPointerMove={(event) => resize(event, "guide")}
          onKeyDown={(event) => resizeWithKeyboard(event, "guide")}
        />
        <GuidePane key={`guide-${selected?.id ?? "empty"}`} recording={selected} />
      </div>
      <SourceDialog
        key={sourceDialogOpen ? "open" : "closed"}
        open={sourceDialogOpen}
        onClose={() => setSourceDialogOpen(false)}
        onStarted={(recordingId) => {
          if (recordingId) setSelectedId(recordingId);

          void refresh();
        }}
      />
    </div>
  );
}
