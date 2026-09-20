import { useDeferredValue, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUpDown,
  Check,
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
  const [draftTitle, setDraftTitle] = useState("");
  const [hasRenameError, setHasRenameError] = useState(false);
  const [isSavingRename, setIsSavingRename] = useState(false);
  const isRenamingRef = useRef(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
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
    if (!openMenuId) return;

    function closeMenu(event: PointerEvent): void {
      if (event.target instanceof Element && event.target.closest(".history-overflow")) {
        return;
      }

      setOpenMenuId(null);
    }

    function closeMenuOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") setOpenMenuId(null);
    }

    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeMenuOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeMenuOnEscape);
    };
  }, [openMenuId]);

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

  function beginRename(recording: RecordingSummary): void {
    if (isRenamingRef.current || snapshot.mutationRequestIds[recording.id]) return;

    setOpenMenuId(null);
    setRenamingId(recording.id);
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
    setOpenMenuId(null);
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

  return (
    <aside className="history-panel">
      <div className="history-header">
        <span className="section-label">{t("history.title")}</span>
        <Button className="history-new-recording" size="sm" onClick={onNewRecording}>
          <Plus aria-hidden="true" size={14} />
          {t("history.newRecording")}
        </Button>
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
        {snapshot.status !== "error" && visibleRecordings.length === 0 && (
          <div className="history-empty">
            <MonitorUp aria-hidden="true" size={20} />
            <span>{t("history.empty")}</span>
          </div>
        )}
        {visibleRecordings.map((recording) => (
          <div
            className={cn("history-item", recording.id === selectedId && "history-item-selected")}
            key={recording.id}
            data-recording-id={recording.id}
          >
            <button className="history-item-main" onClick={() => onSelect(recording.id)}>
              <HistoryItemThumbnail
                recording={recording}
                statusLabel={t(`history.status.${recording.status}`)}
              />
              <span className="history-copy">
                <span className="history-title-line">
                  {renamingId === recording.id ? (
                    <input
                      className="rename-input"
                      disabled={
                        isSavingRename || Boolean(snapshot.mutationRequestIds[recording.id])
                      }
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
                    <strong>{recording.title}</strong>
                  )}
                </span>
                <span className="history-metadata">
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
            {renamingId !== recording.id && (
              <div
                className={cn(
                  "history-item-actions history-overflow",
                  openMenuId === recording.id && "menu-open",
                )}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  aria-haspopup="menu"
                  aria-expanded={openMenuId === recording.id}
                  title={t("actions.more")}
                  onClick={() =>
                    setOpenMenuId((current) => (current === recording.id ? null : recording.id))
                  }
                >
                  <MoreHorizontal size={15} />
                </Button>
                {openMenuId === recording.id && (
                  <div
                    className="history-overflow-dropdown"
                    role="menu"
                    aria-label={t("actions.more")}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      disabled={
                        isSavingRename || Boolean(snapshot.mutationRequestIds[recording.id])
                      }
                      onClick={() => beginRename(recording)}
                    >
                      <Pencil size={13} />
                      {t("actions.rename")}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="danger"
                      onClick={() => requestDelete(recording)}
                    >
                      <Trash2 size={13} />
                      {t("actions.delete")}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
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
