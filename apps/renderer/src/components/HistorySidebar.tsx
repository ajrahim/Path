import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ListFilter,
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderInput,
  LoaderCircle,
  MonitorUp,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { RecordingProject, RecordingSummary } from "@path/shared";
import { Button } from "@/components/Button";
import { formatDuration, formatRecordingDate } from "@/lib/Format";
import { cn } from "@/lib/ClassNames";
import { useAppVersion } from "../hooks/useAppVersion";
import { useRecordingHistory } from "../hooks/useRecordingHistory";
import { HistoryMenu, type HistoryMenuItem } from "./HistoryMenu";
import { ProjectDialog, type ProjectDialogAction } from "./ProjectDialog";
import { RecordingDeleteDialog } from "./RecordingDeleteDialog";
import { RecordingRenameField } from "./RecordingRenameField";
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
  const searchInputRef = useRef<HTMLInputElement>(null);
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase(locale));
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [sortOpen, setSortOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameLocation, setRenameLocation] = useState("all");
  const [hasRenameError, setHasRenameError] = useState(false);
  const [isSavingRename, setIsSavingRename] = useState(false);
  const projectLibrary = useRecordingProjects();
  const [projectAction, setProjectAction] = useState<ProjectDialogAction | null>(null);
  const [projectsExpanded, setProjectsExpanded] = useState(true);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [moveError, setMoveError] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<RecordingSummary | null>(null);
  const [contextMenu, setContextMenu] = useState<
    | {
        target:
          | { kind: "recording"; recording: RecordingSummary; location: string }
          | { kind: "project"; project: RecordingProject };
        x: number;
        y: number;
      }
    | null
  >(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const projectRefs = useRef(new Map<string, HTMLButtonElement>());
  const closeContextMenu = useCallback(() => setContextMenu(null), []);

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
    if (isSavingRename || snapshot.mutationRequestIds[recording.id]) return;

    setRenamingId(recording.id);
    setRenameLocation(location);
    setHasRenameError(false);
  }

  async function saveRename(id: string, title: string): Promise<void> {
    if (isSavingRename || snapshot.mutationRequestIds[id]) return;

    setIsSavingRename(true);
    setHasRenameError(false);

    try {
      await rename(id, title);
      setRenamingId(null);
    } catch {
      setHasRenameError(true);
    } finally {
      setIsSavingRename(false);
    }
  }

  async function confirmDelete(recording: RecordingSummary): Promise<void> {
    await remove(recording.id);
    onDeleted(recording.id);
    setPendingDelete(null);
  }

  function cursorPosition(event: React.MouseEvent<HTMLElement>): { x: number; y: number } {
    // Keyboard-invoked menus report a zero point; anchor those to the row instead.
    if (event.clientX === 0 && event.clientY === 0) {
      const rect = event.currentTarget.getBoundingClientRect();

      return { x: rect.left + 24, y: rect.bottom - 8 };
    }

    return { x: event.clientX, y: event.clientY };
  }

  function openRecordingMenu(
    event: React.MouseEvent<HTMLElement>,
    recording: RecordingSummary,
    location: string,
  ): void {
    // Rename inputs keep their native edit menu.
    if (event.target instanceof HTMLInputElement) return;

    event.preventDefault();

    if (renamingId === recording.id) return;

    onSelect(recording.id);
    setContextMenu({
      target: { kind: "recording", recording, location },
      ...cursorPosition(event),
    });
  }

  function openProjectMenu(event: React.MouseEvent<HTMLElement>, project: RecordingProject): void {
    event.preventDefault();

    if (projectLibrary.saving) return;

    setContextMenu({ target: { kind: "project", project }, ...cursorPosition(event) });
  }

  function returnMenuFocus(): void {
    if (!contextMenu) return;

    if (contextMenu.target.kind === "recording") {
      rowRefs.current
        .get(`${contextMenu.target.location}:${contextMenu.target.recording.id}`)
        ?.focus();
    } else {
      projectRefs.current.get(contextMenu.target.project.id)?.focus();
    }
  }

  function recordingMenuItems(recording: RecordingSummary, location: string): HistoryMenuItem[] {
    return [
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
        onSelect: () => setPendingDelete(recording),
        danger: true,
      },
    ];
  }

  function projectMenuItems(project: RecordingProject): HistoryMenuItem[] {
    return [
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
    ];
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
        onContextMenu={(event) => openRecordingMenu(event, recording, location)}
      >
        <button
          ref={(element) => {
            const key = `${location}:${recording.id}`;

            if (element) rowRefs.current.set(key, element);
            else rowRefs.current.delete(key);
          }}
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
                <RecordingRenameField
                  recording={recording}
                  pending={isSavingRename || Boolean(snapshot.mutationRequestIds[recording.id])}
                  onSave={(title) => saveRename(recording.id, title)}
                  onCancel={() => setRenamingId(null)}
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
      </div>
    );
  }

  return (
    <aside className="history-panel">
      <div className="history-header">
        <button type="button" className="history-new-recording" onClick={onNewRecording}>
          <Video aria-hidden="true" size={15} />
          {t("history.newRecording")}
        </button>
      </div>

      <div className="history-tools">
        <div className="search-control">
          <Search aria-hidden="true" size={14} />
          <input
            ref={searchInputRef}
            aria-label={t("history.search")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                event.preventDefault();
                event.stopPropagation();
                setQuery("");
              }
            }}
            placeholder={t("history.search")}
          />
          {query && (
            <button
              type="button"
              className="history-search-clear"
              aria-label={t("history.clearSearch")}
              title={t("history.clearSearch")}
              onClick={() => {
                setQuery("");
                searchInputRef.current?.focus();
              }}
            >
              <X size={13} aria-hidden="true" />
            </button>
          )}
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
              <ListFilter aria-hidden="true" size={15} />
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
          <div className="history-projects-heading">
            <button
              type="button"
              className="history-projects-disclosure"
              aria-expanded={Boolean(deferredQuery) || projectsExpanded}
              aria-controls="history-project-list"
              onClick={() => setProjectsExpanded((expanded) => !expanded)}
            >
              {t("projects.title")}
              {projectsExpanded || deferredQuery ? (
                <ChevronDown size={12} aria-hidden="true" />
              ) : (
                <ChevronRight size={12} aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              className="history-create-project"
              aria-label={t("projects.createAction")}
              title={t("projects.createAction")}
              disabled={projectLibrary.saving || projectLibrary.status !== "ready"}
              onClick={() => {
                setProjectsExpanded(true);
                setProjectAction({ kind: "create" });
              }}
            >
              <Plus size={15} aria-hidden="true" />
            </button>
          </div>
          <div id="history-project-list" hidden={!projectsExpanded && !deferredQuery}>
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
                  <div
                    className="history-project-heading"
                    onContextMenu={(event) => openProjectMenu(event, project)}
                  >
                    <button
                      ref={(element) => {
                        if (element) projectRefs.current.set(project.id, element);
                        else projectRefs.current.delete(project.id);
                      }}
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
                      <Folder size={16} aria-hidden="true" />
                      <span title={project.name}>{project.name}</span>
                    </button>
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
          </div>
        </section>
        <section className="history-all" aria-label={t("projects.all")}>
          <div className="history-section-label">{t("projects.all")}</div>
          {snapshot.status !== "error" && visibleRecordings.length === 0 && (
            <div className="history-empty">
              {deferredQuery ? (
                <Search aria-hidden="true" size={20} />
              ) : (
                <MonitorUp aria-hidden="true" size={20} />
              )}
              <span>{t(deferredQuery ? "history.noMatches" : "history.empty")}</span>
            </div>
          )}
          {visibleRecordings.map((recording) => renderRecording(recording, "all"))}
        </section>
      </div>

      <HistoryMenu
        label={
          contextMenu?.target.kind === "project"
            ? t("projects.projectActions", { name: contextMenu.target.project.name })
            : t("actions.more")
        }
        anchor={contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null}
        items={
          !contextMenu
            ? []
            : contextMenu.target.kind === "recording"
              ? recordingMenuItems(contextMenu.target.recording, contextMenu.target.location)
              : projectMenuItems(contextMenu.target.project)
        }
        onClose={closeContextMenu}
        returnFocus={returnMenuFocus}
      />
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
      {pendingDelete && (
        <RecordingDeleteDialog
          recording={pendingDelete}
          onConfirm={confirmDelete}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </aside>
  );
}
