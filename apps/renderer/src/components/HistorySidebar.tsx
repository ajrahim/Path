import { useDeferredValue, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderInput,
  Video,
  LoaderCircle,
  MoreHorizontal,
  MonitorUp,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { RecordingSummary } from "@path/shared";
import { Button } from "@/components/Button";
import { formatDuration, formatRecordingDate } from "@/lib/Format";
import { cn } from "@/lib/ClassNames";
import { useAppVersion } from "../hooks/useAppVersion";
import { useRecordingHistory } from "../hooks/useRecordingHistory";
import { HistoryMenu } from "./HistoryMenu";
import { ProjectDialog, type ProjectDialogAction } from "./ProjectDialog";
import { useRecordingProjects } from "../hooks/useRecordingProjects";
import { useRecordingThumbnailUrl } from "../hooks/useRecordingThumbnailUrl";

type SortMode = "newest" | "oldest" | "title";

interface HistorySidebarProps {
  selectedId: string | null;
  onSelect(id: string): void;
  onDeleted(id: string): void;
  onNewRecording(): void;
  onOpenSettings(): void;
}

function sortRecordings(recordings: RecordingSummary[], mode: SortMode): RecordingSummary[] {
  // Sorting the view must not reorder the shared history snapshot.
  return [...recordings].sort((left, right) => {
    if (mode === "title") return left.title.localeCompare(right.title);

    const comparison = Date.parse(right.createdAt) - Date.parse(left.createdAt);

    return mode === "newest" ? comparison : -comparison;
  });
}

function HistoryItemThumbnail({
  recording,
  statusLabel,
}: {
  recording: RecordingSummary;
  statusLabel: string;
}) {
  const thumbnailUrl = useRecordingThumbnailUrl(
    recording.id,
    recording.status,
    recording.thumbnailPath,
  );

  const [imageError, setImageError] = useState(false);

  if (recording.status === "recording") {
    return (
      <span className="history-thumbnail history-thumbnail-recording" title={statusLabel}>
        <span className="history-thumbnail-dot" aria-hidden="true" />
      </span>
    );
  }

  if (recording.status === "processing") {
    return (
      <span className="history-thumbnail history-thumbnail-processing" title={statusLabel}>
        <LoaderCircle className="history-thumbnail-spinner" aria-hidden="true" size={18} />
      </span>
    );
  }

  if (recording.status === "failed") {
    return (
      <span className="history-thumbnail history-thumbnail-failed" title={statusLabel}>
        <AlertCircle aria-hidden="true" size={18} />
      </span>
    );
  }

  if (thumbnailUrl && !imageError) {
    return (
      <span className="history-thumbnail">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={thumbnailUrl}
          alt=""
          draggable={false}
          className="history-thumbnail-image"
          onError={() => setImageError(true)}
        />
      </span>
    );
  }

  return (
    <span className="history-thumbnail">
      <MonitorUp aria-hidden="true" size={15} />
    </span>
  );
}

export function HistorySidebar({
  selectedId,
  onSelect,
  onDeleted,
  onNewRecording,
  onOpenSettings,
}: HistorySidebarProps) {
  const t = useTranslations();
  const locale = useLocale();
  const appVersion = useAppVersion();
  const versionLabel = appVersion
    ? appVersion.startsWith("v")
      ? appVersion
      : `v${appVersion}`
    : "";

  const { snapshot, refresh, rename, remove } = useRecordingHistory();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase(locale));
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [sortOpen, setSortOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameLocation, setRenameLocation] = useState("all");
  const [draftTitle, setDraftTitle] = useState("");
  const [hasRenameError, setHasRenameError] = useState(false);
  const [isSavingRename, setIsSavingRename] = useState(false);
  const isRenamingRef = useRef(false);
  const projectLibrary = useRecordingProjects();
  const [projectAction, setProjectAction] = useState<ProjectDialogAction | null>(null);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [moveError, setMoveError] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<RecordingSummary | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const deletingRef = useRef(false);

  useEffect(() => {
    if (!pendingDelete) return;

    const dialog = deleteDialogRef.current;

    dialog?.showModal();

    // Start on the reversible choice when the native modal receives keyboard focus.
    dialog?.querySelector<HTMLButtonElement>("[data-cancel-delete]")?.focus();

    return () => dialog?.close();
  }, [pendingDelete]);

  useEffect(() => {
    const request = refresh();

    return () => request.abort();
  }, [refresh]);

  useEffect(() => {
    if (!sortOpen) return;

    function closeSortMenu(event: PointerEvent): void {
      if (event.target instanceof Element && event.target.closest(".sort-control")) {
        return;
      }

      setSortOpen(false);
    }

    function closeSortMenuOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") setSortOpen(false);
    }

    document.addEventListener("pointerdown", closeSortMenu);
    document.addEventListener("keydown", closeSortMenuOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeSortMenu);
      document.removeEventListener("keydown", closeSortMenuOnEscape);
    };
  }, [sortOpen]);

  const visibleRecordings = sortRecordings(
    snapshot.recordings.filter((recording) =>
      recording.title.toLocaleLowerCase(locale).includes(deferredQuery),
    ),
    sortMode,
  );

  function beginRename(recording: RecordingSummary, location: string): void {
    if (isRenamingRef.current || snapshot.mutationRequestIds[recording.id]) return;

    setRenamingId(recording.id);
    setRenameLocation(location);
    setDraftTitle(recording.title);
    setHasRenameError(false);
  }

  async function saveRename(id: string): Promise<void> {
    if (!draftTitle.trim() || isRenamingRef.current || snapshot.mutationRequestIds[id]) return;

    // Enter and blur can arrive before React renders the pending state.
    isRenamingRef.current = true;
    setIsSavingRename(true);
    setHasRenameError(false);

    try {
      await rename(id, draftTitle.trim());
      setRenamingId(null);
    } catch {
      setHasRenameError(true);
    } finally {
      isRenamingRef.current = false;
      setIsSavingRename(false);
    }
  }

  function requestDelete(recording: RecordingSummary): void {
    setDeleteError(null);
    setPendingDelete(recording);
  }

  async function confirmDelete(): Promise<void> {
    if (!pendingDelete || deletingRef.current) return;

    deletingRef.current = true;
    setDeleting(true);
    setDeleteError(null);

    try {
      await remove(pendingDelete.id);
      onDeleted(pendingDelete.id);
      setPendingDelete(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : t("history.deleteError"));
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  }

  function dropHandlers(projectId: string | null) {
    const target = projectId ?? "ungrouped";

    return {
      onDragEnter(event: React.DragEvent<HTMLElement>) {
        if (!draggingId || projectLibrary.saving) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropTarget(target);
      },
      onDragOver(event: React.DragEvent<HTMLElement>) {
        if (!draggingId || projectLibrary.saving) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropTarget(target);
      },
      onDragLeave(event: React.DragEvent<HTMLElement>) {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          setDropTarget(null);
        }
      },
      onDrop(event: React.DragEvent<HTMLElement>) {
        event.preventDefault();
        const id = event.dataTransfer.getData("application/x-path-recording");

        setDropTarget(null);
        setDraggingId(null);
        if (
          !id ||
          id !== draggingId ||
          !snapshot.recordings.some((recording) => recording.id === id) ||
          projectLibrary.saving
        ) {
          return;
        }

        setMoveError(false);
        void projectLibrary
          .change({ action: "move", recordingId: id, projectId })
          .then(() => {
            if (projectId) {
              setCollapsedProjects((current) => {
                const next = new Set(current);

                next.delete(projectId);

                return next;
              });
            }
          })
          .catch(() => setMoveError(true));
      },
    };
  }

  function renderRecording(recording: RecordingSummary, location: string) {
    const isRenaming = renamingId === recording.id && renameLocation === location;
    const metadata = `${formatRecordingDate(recording.createdAt, locale)} - ${recording.status === "ready" ? formatDuration(recording.durationMs, t("history.status.ready")) : t(`history.status.${recording.status}`)}`;
    const canDrag =
      renamingId !== recording.id && !projectLibrary.saving && projectLibrary.status === "ready";

    return (
      <div
        className={cn("history-item", recording.id === selectedId && "history-item-selected")}
        key={recording.id}
        data-recording-id={recording.id}
        draggable={canDrag}
        onDragStart={(event) => {
          event.dataTransfer.setData("application/x-path-recording", recording.id);
          event.dataTransfer.effectAllowed = "move";
          setDraggingId(recording.id);
        }}
        onDragEnd={() => {
          setDraggingId(null);
          setDropTarget(null);
        }}
      >
        <button
          className="history-item-main"
          draggable={canDrag}
          title={`${recording.title} - ${metadata}`}
          aria-pressed={recording.id === selectedId}
          aria-label={`${recording.title}, ${metadata}`}
          onClick={() => onSelect(recording.id)}
        >
          <HistoryItemThumbnail
            recording={recording}
            statusLabel={t(`history.status.${recording.status}`)}
          />
          <span className="history-copy">
            <span className="history-title-line">
              {isRenaming ? (
                <input
                  className="rename-input"
                  disabled={isSavingRename || Boolean(snapshot.mutationRequestIds[recording.id])}
                  value={draftTitle}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => setDraftTitle(event.target.value)}
                  onBlur={() => {
                    if (draftTitle.trim()) void saveRename(recording.id);
                    else setRenamingId(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void saveRename(recording.id);
                    }

                    if (event.key === "Escape") setRenamingId(null);
                  }}
                  autoFocus
                />
              ) : (
                <strong title={recording.title}>{recording.title}</strong>
              )}
            </span>
            <span className="sr-only">
              <span className="history-date">
                {formatRecordingDate(recording.createdAt, locale)}
              </span>
              <span className="history-detail">
                ·{" "}
                {recording.status === "ready"
                  ? formatDuration(recording.durationMs, t("history.status.ready"))
                  : t(`history.status.${recording.status}`)}
              </span>
            </span>
          </span>
        </button>
        {!isRenaming && (
          <div className="history-item-actions history-overflow">
            <HistoryMenu
              label={t("actions.more")}
              className="history-row-menu"
              items={[
                {
                  label: t("actions.rename"),
                  icon: <Pencil size={14} />,
                  onSelect: () => beginRename(recording, location),
                  disabled: isSavingRename || Boolean(snapshot.mutationRequestIds[recording.id]),
                },
                {
                  label: t("projects.moveTitle"),
                  icon: <FolderInput size={14} />,
                  onSelect: () =>
                    setProjectAction({
                      kind: "move",
                      recordingId: recording.id,
                      projectId:
                        projectLibrary.projects.find((project) =>
                          project.recordingIds.includes(recording.id),
                        )?.id ?? null,
                    }),
                  disabled: projectLibrary.saving || projectLibrary.status !== "ready",
                },
                {
                  label: t("actions.delete"),
                  icon: <Trash2 size={14} />,
                  onSelect: () => requestDelete(recording),
                  danger: true,
                },
              ]}
            >
              <MoreHorizontal size={15} aria-hidden="true" />
            </HistoryMenu>
          </div>
        )}
      </div>
    );
  }

  return (
    <aside className="history-panel">
      <div className="history-header">
        <span className="section-label">{t("history.title")}</span>
        <HistoryMenu
          label={t("history.newRecording")}
          className="history-new-recording"
          items={[
            { label: t("projects.recording"), icon: <Video size={15} />, onSelect: onNewRecording },
            {
              label: t("projects.project"),
              icon: <Folder size={15} />,
              onSelect: () => setProjectAction({ kind: "create" }),
              disabled: projectLibrary.saving || projectLibrary.status !== "ready",
            },
          ]}
        >
          <Plus aria-hidden="true" size={14} />
          {t("history.newRecording")}
          <ChevronDown aria-hidden="true" size={12} />
        </HistoryMenu>
      </div>

      <div className="history-tools">
        <label className="search-control">
          <Search aria-hidden="true" size={14} />
          <span className="sr-only">{t("history.search")}</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("history.search")}
          />
        </label>
        <div className="sort-control">
          <button
            type="button"
            className="sort-trigger"
            title={t("history.sort")}
            aria-label={t("history.sort")}
            aria-haspopup="menu"
            aria-expanded={sortOpen}
            onClick={() => setSortOpen((value) => !value)}
          >
            <ArrowUpDown aria-hidden="true" size={14} />
          </button>
          {sortOpen && (
            <div className="sort-dropdown" role="menu" aria-label={t("history.sort")}>
              {(
                [
                  ["newest", t("history.sortNewest")],
                  ["oldest", t("history.sortOldest")],
                  ["title", t("history.sortTitle")],
                ] as const
              ).map(([value, label]) => (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={sortMode === value}
                  key={value}
                  onClick={() => {
                    setSortMode(value);
                    setSortOpen(false);
                  }}
                >
                  <span>{label}</span>
                  {sortMode === value && <Check aria-hidden="true" size={14} />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="history-list">
        {hasRenameError && (
          <p className="panel-message" role="alert">
            {t("navigation.titleSaveFailed")}
          </p>
        )}
        {snapshot.status === "error" && <p className="panel-message">{t("history.loadError")}</p>}
        {projectLibrary.status === "error" && (
          <div className="project-error" role="alert">
            {t("projects.loadError")}{" "}
            <button type="button" onClick={() => void projectLibrary.refresh()}>
              {t("projects.retry")}
            </button>
          </div>
        )}
        {moveError && (
          <p className="project-error" role="alert">
            {t("projects.changeError")}
          </p>
        )}
        <section className="history-projects" aria-label={t("projects.title")}>
          <div className="history-section-label">{t("projects.title")}</div>
          {projectLibrary.projects.length === 0 && (
            <button
              type="button"
              className="history-create-project"
              disabled={projectLibrary.saving || projectLibrary.status !== "ready"}
              onClick={() => setProjectAction({ kind: "create" })}
            >
              <Plus size={14} aria-hidden="true" />
              {t("projects.createAction")}
            </button>
          )}
          {projectLibrary.projects.map((project) => {
            const matchesName = project.name.toLocaleLowerCase(locale).includes(deferredQuery);
            const members = (
              deferredQuery && matchesName
                ? sortRecordings(snapshot.recordings, sortMode)
                : visibleRecordings
            ).filter((recording) => project.recordingIds.includes(recording.id));

            if (deferredQuery && !matchesName && members.length === 0) return null;
            const expanded = Boolean(deferredQuery) || !collapsedProjects.has(project.id);

            return (
              <section
                key={project.id}
                className={cn(
                  "history-project",
                  dropTarget === project.id && "project-drop-target",
                )}
                aria-label={project.name}
                {...dropHandlers(project.id)}
              >
                <div className="history-project-heading">
                  <button
                    type="button"
                    className="history-project-toggle"
                    aria-expanded={expanded}
                    aria-label={project.name}
                    aria-controls={`project-${project.id}`}
                    onClick={() =>
                      setCollapsedProjects((current) => {
                        const next = new Set(current);

                        if (next.has(project.id)) next.delete(project.id);
                        else next.add(project.id);

                        return next;
                      })
                    }
                  >
                    {expanded ? (
                      <ChevronDown size={12} aria-hidden="true" />
                    ) : (
                      <ChevronRight size={12} aria-hidden="true" />
                    )}
                    <Folder size={16} aria-hidden="true" />
                    <span title={project.name}>{project.name}</span>
                    <small>{members.length}</small>
                  </button>
                  <HistoryMenu
                    label={t("projects.projectActions", { name: project.name })}
                    className="history-row-menu"
                    disabled={projectLibrary.saving}
                    items={[
                      {
                        label: t("actions.rename"),
                        icon: <Pencil size={14} />,
                        onSelect: () => setProjectAction({ kind: "rename", project }),
                      },
                      {
                        label: t("projects.removeTitle"),
                        icon: <Trash2 size={14} />,
                        onSelect: () => setProjectAction({ kind: "remove", project }),
                      },
                    ]}
                  >
                    <MoreHorizontal size={15} aria-hidden="true" />
                  </HistoryMenu>
                </div>
                {expanded && (
                  <div id={`project-${project.id}`} className="history-project-recordings">
                    {members.map((recording) => renderRecording(recording, project.id))}
                    {members.length === 0 && (
                      <p className="project-drop-hint">{t("projects.dropHere")}</p>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </section>
        <section className="history-all" aria-label={t("projects.all")}>
          <div className="history-section-label">{t("projects.all")}</div>
          {snapshot.status !== "error" && visibleRecordings.length === 0 && (
            <div className="history-empty">
              <MonitorUp aria-hidden="true" size={20} />
              <span>{t("history.empty")}</span>
            </div>
          )}
          {visibleRecordings.map((recording) => renderRecording(recording, "all"))}
        </section>
      </div>

      <div className="history-footer">
        <Button
          className="history-settings"
          variant="ghost"
          size="icon"
          title={t("navigation.settings")}
          aria-label={t("navigation.settings")}
          onClick={onOpenSettings}
        >
          <Settings aria-hidden="true" size={16} />
        </Button>
        {versionLabel && <span className="history-version">{versionLabel}</span>}
      </div>
      {projectAction && (
        <ProjectDialog
          action={projectAction}
          projects={projectLibrary.projects}
          change={projectLibrary.change}
          onClose={() => setProjectAction(null)}
        />
      )}
      <dialog
        ref={deleteDialogRef}
        className="recording-delete-dialog"
        aria-labelledby="recording-delete-title"
        aria-describedby="recording-delete-description"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (!deletingRef.current) setPendingDelete(null);
          }
        }}
        onCancel={(event) => {
          event.preventDefault();
          if (!deletingRef.current) setPendingDelete(null);
        }}
      >
        <h2 id="recording-delete-title">{t("history.deleteTitle")}</h2>
        <p className="recording-delete-name">{pendingDelete?.title}</p>
        <p id="recording-delete-description">{t("history.deleteDescription")}</p>
        {deleteError && (
          <p className="settings-inline-error" role="alert">
            {deleteError}
          </p>
        )}
        <footer>
          <Button
            data-cancel-delete
            variant="secondary"
            disabled={deleting}
            onClick={() => setPendingDelete(null)}
          >
            {t("actions.cancel")}
          </Button>
          <Button variant="danger" disabled={deleting} onClick={() => void confirmDelete()}>
            <Trash2 aria-hidden="true" size={15} />
            {deleting ? t("history.deleting") : t("actions.delete")}
          </Button>
        </footer>
      </dialog>
    </aside>
  );
}
