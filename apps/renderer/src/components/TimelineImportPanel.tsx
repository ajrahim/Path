import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ChevronRight,
  Clock3,
  FileText,
  FileUp,
  LoaderCircle,
  ScrollText,
  Search,
  SquareMousePointer,
  Trash2,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  MAX_TIMELINE_IMPORT_OFFSET_MS,
  type RecordingTimeWindow,
  type TimelineImport,
  type TimelineImportEntry,
  type TimelineImportKind,
} from "@path/shared";
import { cn } from "@/lib/ClassNames";
import {
  formatMediaOffset,
  formatRecordingDate,
  formatWallClockTime,
  formatWallClockTimestamp,
} from "@/lib/Format";
import { useVirtualRows } from "../hooks/useVirtualRows";
import { Button } from "./Button";
import { timelinePanelId, timelineTabId } from "./TimelineTabs";

// Rows have a fixed height so only the visible slice of a large import is rendered.
const IMPORT_ROW_HEIGHT_PX = 34;

const KIND_MESSAGE_KEYS = {
  log: {
    import: "importLogFile",
    remove: "removeLogImport",
    search: "searchLogs",
    empty: "logImportEmpty",
  },
  element: {
    import: "importElementFile",
    remove: "removeElementImport",
    search: "searchElements",
    empty: "elementImportEmpty",
  },
} as const;

/** Logs or Elements review tab: imported rows aligned to the selected recording's video time. */
export function TimelineImportPanel({
  tabs,
  kind,
  recordingSelected,
  timeWindow,
  timelineImport,
  isLoading,
  isBusy,
  error,
  currentTimeMs,
  playing,
  onImport,
  onOffsetChange,
  onRemove,
  onSeek,
}: {
  tabs: ReactNode;
  kind: TimelineImportKind;
  recordingSelected: boolean;
  timeWindow: RecordingTimeWindow | null;
  timelineImport: TimelineImport | null;
  isLoading: boolean;
  isBusy: boolean;
  error: string | null;
  currentTimeMs: number;
  playing: boolean;
  onImport(): void;
  onOffsetChange(offsetMs: number): void;
  onRemove(): void;
  onSeek(timestampMs: number): void;
}) {
  const t = useTranslations("recording");
  const locale = useLocale();
  const messageKeys = KIND_MESSAGE_KEYS[kind];
  const KindIcon = kind === "log" ? ScrollText : SquareMousePointer;
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const isPointerInsideListRef = useRef(false);
  const canImport = recordingSelected && timeWindow !== null && !isLoading;
  const entries = timelineImport?.entries;
  const normalizedQuery = query.trim().toLocaleLowerCase();

  const visibleEntries = useMemo(() => {
    if (!entries) return [];
    if (!normalizedQuery) return entries;

    return entries.filter((entry) => entry.text.toLocaleLowerCase().includes(normalizedQuery));
  }, [entries, normalizedQuery]);

  const activeIndex = playing ? lastIndexAtOrBefore(visibleEntries, currentTimeMs) : -1;
  const { attachContainer, startIndex, endIndex, totalHeight, offsetTop, onScroll, revealIndex } =
    useVirtualRows(visibleEntries.length, IMPORT_ROW_HEIGHT_PX);

  // Follow playback like Activity, unless the pointer is over the list.
  useEffect(() => {
    if (activeIndex < 0 || isPointerInsideListRef.current) return;

    revealIndex(activeIndex);
  }, [activeIndex, revealIndex]);

  let emptyLabel: string | null = null;

  if (!recordingSelected) {
    emptyLabel = t("selectPrompt");
  } else if (isLoading) {
    emptyLabel = t("importLoading");
  } else if (!timeWindow) {
    // Processing recordings already have a window; only an active capture lacks one.
    // A failed load shows its error alone instead of implying the recording is unfinished.
    emptyLabel = error ? null : t("importUnavailable");
  } else if (timelineImport && timelineImport.entries.length === 0) {
    emptyLabel = t("noRowsInVideo");
  } else if (timelineImport && visibleEntries.length === 0) {
    emptyLabel = t("noMatchingRows");
  }

  return (
    <section
      className="transcript-panel timeline-import-panel"
      role="tabpanel"
      id={timelinePanelId(kind)}
      aria-labelledby={timelineTabId(kind)}
    >
      <header>
        <div className="activity-heading">{tabs}</div>
        <div className="activity-header-actions">
          {timelineImport && (
            <button
              type="button"
              className="timeline-import-action timeline-import-remove"
              title={t(messageKeys.remove)}
              aria-label={t(messageKeys.remove)}
              disabled={isBusy}
              onClick={onRemove}
            >
              <Trash2 size={13} />
            </button>
          )}
          <Button
            size="sm"
            variant="secondary"
            title={t(messageKeys.import)}
            aria-busy={isBusy}
            disabled={!canImport || isBusy}
            onClick={onImport}
          >
            {isBusy ? (
              <LoaderCircle className="timeline-import-spinner" size={14} aria-hidden="true" />
            ) : (
              <FileUp size={14} aria-hidden="true" />
            )}
            {t("import")}
          </Button>
        </div>
      </header>
      {timeWindow && (
        <p className="timeline-import-meta">
          <span
            className="timeline-import-window"
            title={timeWindow.isApproximate ? t("approximateTimeHint") : undefined}
          >
            <Clock3 size={12} aria-hidden="true" />
            {t("videoTimeRange", {
              date: formatRecordingDate(timeWindow.startedAt, locale),
              start: formatWallClockTime(timeWindow.startedAt, locale),
              end: formatWallClockTime(timeWindow.endedAt, locale),
            })}
          </span>
          {timeWindow.isApproximate && (
            <span className="timeline-import-approximate" title={t("approximateTimeHint")}>
              {t("approximateTime")}
            </span>
          )}
          {timelineImport && (
            <>
              <span className="timeline-import-file" title={timelineImport.fileName}>
                <FileText size={12} aria-hidden="true" />
                <span>{timelineImport.fileName}</span>
              </span>
              <span>{t("importRowCount", { count: timelineImport.entries.length })}</span>
              {timelineImport.outsideCount > 0 && (
                <span>{t("importOutsideCount", { count: timelineImport.outsideCount })}</span>
              )}
              {timelineImport.unreadableLineCount > 0 && (
                <span>
                  {t("importUnreadableCount", { count: timelineImport.unreadableLineCount })}
                </span>
              )}
            </>
          )}
        </p>
      )}
      {timelineImport && (
        <div className="activity-toolbar">
          <div className="transcript-search activity-search">
            <Search size={14} aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t(messageKeys.search)}
              aria-label={t(messageKeys.search)}
            />
          </div>
          <ImportOffsetField
            key={timelineImport.offsetMs}
            offsetMs={timelineImport.offsetMs}
            disabled={isBusy}
            onCommit={onOffsetChange}
          />
        </div>
      )}
      {error && (
        <p className="activity-error" role="alert">
          {error}
        </p>
      )}
      {emptyLabel !== null && (
        <div className="transcript-empty">
          <KindIcon aria-hidden="true" size={18} />
          <span>{emptyLabel}</span>
        </div>
      )}
      {emptyLabel === null && timeWindow && !timelineImport && (
        <div className="transcript-empty timeline-import-empty">
          <KindIcon aria-hidden="true" size={18} />
          <span>{t(messageKeys.empty)}</span>
          <Button disabled={!canImport || isBusy} onClick={onImport}>
            <FileUp size={16} aria-hidden="true" />
            {t(messageKeys.import)}
          </Button>
        </div>
      )}
      {emptyLabel === null && timelineImport && (
        <div
          ref={attachContainer}
          className="timeline-import-list"
          onScroll={onScroll}
          onPointerEnter={() => {
            isPointerInsideListRef.current = true;
          }}
          onPointerLeave={() => {
            isPointerInsideListRef.current = false;
          }}
        >
          <ol
            aria-label={t(kind === "log" ? "logs" : "elements")}
            // Runtime geometry: the list keeps its full height while only nearby rows render.
            style={{ height: totalHeight, paddingTop: offsetTop }}
          >
            {visibleEntries.slice(startIndex, endIndex).map((entry, sliceIndex) => (
              <ImportedRow
                key={entry.id}
                entry={entry}
                kind={kind}
                locale={locale}
                selected={entry.id === selectedId}
                active={startIndex + sliceIndex === activeIndex}
                onSelect={() => {
                  setSelectedId(entry.id);
                  onSeek(entry.timestampMs);
                }}
              />
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

function ImportedRow({
  entry,
  kind,
  locale,
  selected,
  active,
  onSelect,
}: {
  entry: TimelineImportEntry;
  kind: TimelineImportKind;
  locale: string;
  selected: boolean;
  active: boolean;
  onSelect(): void;
}) {
  const t = useTranslations("recording");
  const [firstLine = "", ...moreLines] = entry.text.split("\n");
  const originalTime = formatWallClockTimestamp(new Date(entry.occurredAt), locale);

  return (
    <li
      className={cn(
        "timeline-import-row",
        selected && "selected",
        active && "timeline-import-row-active",
      )}
      style={{ height: IMPORT_ROW_HEIGHT_PX }}
    >
      <button
        type="button"
        aria-pressed={selected}
        title={`${t("originalTime", { time: originalTime })}\n${entry.text}`}
        onClick={onSelect}
      >
        <span className="timeline-import-time">{formatMediaOffset(entry.timestampMs)}</span>
        {kind === "element" ? (
          <ElementPath path={firstLine} />
        ) : (
          <span className="timeline-import-text">{firstLine}</span>
        )}
        {moreLines.length > 0 && (
          <span className="timeline-import-more">
            {t("importMoreLines", { count: moreLines.length })}
          </span>
        )}
      </button>
    </li>
  );
}

/** Element paths such as `Header > #div > .menu` render as breadcrumb segments. */
function ElementPath({ path }: { path: string }) {
  const segments = path.split(/\s*>\s*/).filter(Boolean);

  return (
    <span className="timeline-import-text timeline-element-path">
      {segments.map((segment, index) => (
        <span key={index} className="timeline-element-segment">
          {index > 0 && <ChevronRight size={11} aria-hidden="true" />}
          <code>{segment}</code>
        </span>
      ))}
    </span>
  );
}

/** Seconds with millisecond precision; commits on Enter or blur and reverts on Escape. */
function ImportOffsetField({
  offsetMs,
  disabled,
  onCommit,
}: {
  offsetMs: number;
  disabled: boolean;
  onCommit(offsetMs: number): void;
}) {
  const t = useTranslations("recording");
  const savedDraft = (offsetMs / 1_000).toString();
  const [draft, setDraft] = useState(savedDraft);

  function commit(): void {
    const seconds = Number(draft.trim());
    const nextOffsetMs = Math.round(seconds * 1_000);

    if (
      !draft.trim() ||
      !Number.isFinite(seconds) ||
      Math.abs(nextOffsetMs) > MAX_TIMELINE_IMPORT_OFFSET_MS ||
      nextOffsetMs === offsetMs
    ) {
      setDraft(savedDraft);

      return;
    }

    onCommit(nextOffsetMs);
  }

  return (
    <label className="timeline-import-offset" title={t("importOffsetHint")}>
      <span>{t("importOffset")}</span>
      <input
        type="number"
        inputMode="decimal"
        step="0.1"
        value={draft}
        disabled={disabled}
        aria-label={t("importOffsetLabel")}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }

          if (event.key === "Escape") {
            setDraft(savedDraft);
          }
        }}
      />
      <span aria-hidden="true">{t("importOffsetUnit")}</span>
    </label>
  );
}

/** Entries are chronological, so binary search finds the row at or before the playhead. */
function lastIndexAtOrBefore(entries: TimelineImportEntry[], timestampMs: number): number {
  let low = 0;
  let high = entries.length - 1;
  let found = -1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const entry = entries[middle];

    if (entry && entry.timestampMs <= timestampMs) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return found;
}
