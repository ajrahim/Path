import type { ReactNode, RefObject } from "react";
import { MousePointer2, RotateCcw, Search } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { ClickEvent, TranscriptSegment } from "@path/shared";
import { activityKey, type OrderedTimelineEntry } from "@path/timeline";
import { formatClickTimestamp, formatPlayerTime } from "@/lib/Format";
import { clickLabel, displayedClickAction } from "@/lib/ActivityPresentation";
import { cn } from "@/lib/ClassNames";
import { ActivityActionMenu } from "./ActivityActionMenu";
import { ActivityTypeSelect } from "./ActivityTypeSelect";
import { ScreenshotAction } from "./ScreenshotAction";
import { timelinePanelId, timelineTabId } from "./TimelineTabs";

export type TimelineFilter = "all" | "clicks" | "speech";

export function ActivityTimeline({
  tabs,
  recordingSelected,
  timeline,
  allCount,
  clickCount,
  speechCount,
  filter,
  query,
  selectedActivityKey,
  activePlaybackKey,
  playing,
  pendingIds,
  analyzingClicks,
  error,
  emptyLabel,
  canRetryAnalysis,
  listRef,
  onScrollPause,
  onFilterChange,
  onQueryChange,
  onRetryAnalysis,
  onSelectClick,
  onSelectTranscript,
  onFocusActivity,
  onSaveClickDescription,
  onSaveTranscript,
  onRemoveClick,
  onRemoveTranscript,
  onOpenScreenshot,
  onInsertScreenshot,
  onPreviewScreenshot,
  onPreviewEnd,
  onUserScrollChange,
}: {
  tabs: ReactNode;
  recordingSelected: boolean;
  timeline: OrderedTimelineEntry[];
  allCount: number;
  clickCount: number;
  speechCount: number;
  filter: TimelineFilter;
  query: string;
  selectedActivityKey: string | null;
  activePlaybackKey: string | null;
  playing: boolean;
  pendingIds: string[];
  analyzingClicks: boolean;
  error: string | null;
  emptyLabel: string;
  canRetryAnalysis: boolean;
  listRef: RefObject<HTMLOListElement | null>;
  onScrollPause(): void;
  onFilterChange(filter: TimelineFilter): void;
  onQueryChange(query: string): void;
  onRetryAnalysis(): void;
  onSelectClick(click: ClickEvent): void;
  onSelectTranscript(segment: TranscriptSegment): void;
  onFocusActivity(key: string): void;
  onSaveClickDescription(click: ClickEvent, text: string, editor: HTMLElement): void;
  onSaveTranscript(segment: TranscriptSegment, text: string, editor: HTMLElement): void;
  onRemoveClick(click: ClickEvent): void;
  onRemoveTranscript(segment: TranscriptSegment): void;
  onOpenScreenshot(click: ClickEvent, url: string): void;
  onInsertScreenshot(click: ClickEvent, url: string): void;
  onPreviewScreenshot(click: ClickEvent, url: string, anchor: DOMRect): void;
  onPreviewEnd(): void;
  onUserScrollChange(scrolling: boolean): void;
}) {
  const t = useTranslations();
  const locale = useLocale();

  return (
    <section
      className="transcript-panel"
      role="tabpanel"
      id={timelinePanelId("activity")}
      aria-labelledby={timelineTabId("activity")}
    >
      <header>
        <div className="activity-heading">
          {tabs}
          {analyzingClicks && (
            <span className="activity-summary" title={t("recording.analyzingClicks")}>
              {t("recording.analyzingClicks")}
            </span>
          )}
        </div>
        {canRetryAnalysis && (
          <div className="activity-header-actions">
            <button
              type="button"
              className="activity-retry"
              title={t("recording.retryAnalysis")}
              aria-label={t("recording.retryAnalysis")}
              onClick={onRetryAnalysis}
            >
              <RotateCcw size={13} />
            </button>
          </div>
        )}
      </header>
      <div className="activity-toolbar">
        <div className="search-control activity-search-control">
          <Search size={14} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t("recording.searchTranscript")}
            aria-label={t("recording.searchTranscript")}
          />
          <ActivityTypeSelect
            value={filter}
            counts={{ all: allCount, clicks: clickCount, speech: speechCount }}
            onChange={onFilterChange}
          />
        </div>
      </div>
      {error && (
        <p className="activity-error" role="alert">
          {error}
        </p>
      )}
      {recordingSelected && timeline.length > 0 ? (
        <ol
          ref={listRef}
          className="activity-cards"
          aria-label={t("recording.activity")}
          onPointerEnter={() => onUserScrollChange(true)}
          onPointerLeave={() => onUserScrollChange(false)}
          onScroll={() => {
            onUserScrollChange(true);
            onScrollPause();
          }}
        >
          {timeline.map((entry) =>
            entry.type === "click" ? (
              <ClickActivityRow
                key={activityKey(entry)}
                entry={entry}
                locale={locale}
                selected={activityKey(entry) === selectedActivityKey}
                playing={playing && activityKey(entry) === activePlaybackKey}
                pending={pendingIds.includes(entry.click.id)}
                onSelect={() => onSelectClick(entry.click)}
                onFocusActivity={() => onFocusActivity(activityKey(entry))}
                onSave={(text, editor) => onSaveClickDescription(entry.click, text, editor)}
                onRemove={() => onRemoveClick(entry.click)}
                onOpen={(url) => onOpenScreenshot(entry.click, url)}
                onInsert={(url) => onInsertScreenshot(entry.click, url)}
                onPreview={(url, anchor) => onPreviewScreenshot(entry.click, url, anchor)}
                onPreviewEnd={onPreviewEnd}
              />
            ) : (
              <TranscriptActivityRow
                key={activityKey(entry)}
                entry={entry}
                selected={activityKey(entry) === selectedActivityKey}
                playing={playing && activityKey(entry) === activePlaybackKey}
                pending={pendingIds.includes(entry.segment.id)}
                onSelect={() => onSelectTranscript(entry.segment)}
                onFocusActivity={() => onFocusActivity(activityKey(entry))}
                onSave={(text, editor) => onSaveTranscript(entry.segment, text, editor)}
                onRemove={() => onRemoveTranscript(entry.segment)}
              />
            ),
          )}
        </ol>
      ) : (
        <div className="transcript-empty">
          <MousePointer2 aria-hidden="true" size={18} />
          <span>{emptyLabel}</span>
        </div>
      )}
    </section>
  );
}

function ClickActivityRow({
  entry,
  locale,
  selected,
  playing,
  pending,
  onSelect,
  onFocusActivity,
  onSave,
  onRemove,
  onOpen,
  onInsert,
  onPreview,
  onPreviewEnd,
}: {
  entry: Extract<OrderedTimelineEntry, { type: "click" }>;
  locale: string;
  selected: boolean;
  playing: boolean;
  pending: boolean;
  onFocusActivity(): void;
  onSelect(): void;
  onSave(text: string, editor: HTMLElement): void;
  onRemove(): void;
  onOpen(url: string): void;
  onInsert(url: string): void;
  onPreview(url: string, anchor: DOMRect): void;
  onPreviewEnd(): void;
}) {
  const t = useTranslations();
  const label = displayedClickAction(t, entry.click);
  const time = formatPlayerTime(entry.click.timestampMs / 1_000);

  return (
    <li
      className={cn(
        "activity-entry activity-entry-click",
        selected && "selected",
        playing && "activity-entry-playback-active",
      )}
      data-activity-id={activityKey(entry)}
      data-timestamp-ms={entry.timestampMs}
    >
      <div className="activity-entry-main" onClick={onSelect}>
        <div className="activity-entry-meta">
          <button
            type="button"
            className="activity-time"
            aria-pressed={selected}
            aria-label={`${clickLabel(t, entry.click.button)} ${time}`}
            title={formatClickTimestamp(entry.click.createdAt, entry.click.timestampMs, locale)}
          >
            {time}
          </button>
          <span className="activity-meta-separator" aria-hidden="true">
            -
          </span>
          <button
            type="button"
            className="activity-type-badge activity-type-badge-click"
            aria-pressed={selected}
          >
            {clickLabel(t, entry.click.button)}
          </button>
        </div>
        <span
          className="activity-click-editor"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="false"
          aria-label={t("recording.editClickDescription")}
          onFocus={onFocusActivity}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }

            if (event.key === "Escape") {
              event.currentTarget.textContent = label;
              event.currentTarget.blur();
            }
          }}
          onBlur={(event) => onSave(event.currentTarget.innerText, event.currentTarget)}
        >
          {label}
        </span>
      </div>
      <div className="activity-actions">
        <ScreenshotAction
          click={entry.click}
          onOpen={(url) => {
            onSelect();
            onOpen(url);
          }}
          onInsert={onInsert}
          onRemove={onRemove}
          removeDisabled={pending}
          onPreview={onPreview}
          onPreviewEnd={onPreviewEnd}
        />
      </div>
    </li>
  );
}

function TranscriptActivityRow({
  entry,
  selected,
  playing,
  pending,
  onFocusActivity,
  onSelect,
  onSave,
  onRemove,
}: {
  entry: Extract<OrderedTimelineEntry, { type: "transcript" }>;
  selected: boolean;
  playing: boolean;
  pending: boolean;
  onFocusActivity(): void;
  onSelect(): void;
  onSave(text: string, editor: HTMLElement): void;
  onRemove(): void;
}) {
  const t = useTranslations();
  const range = `${formatPlayerTime(entry.segment.startMs / 1_000)} - ${formatPlayerTime(entry.segment.endMs / 1_000)}`;

  return (
    <li
      data-activity-id={activityKey(entry)}
      data-timestamp-ms={entry.timestampMs}
      className={cn(
        "activity-entry transcript-entry",
        selected && "selected",
        playing && "activity-entry-playback-active",
      )}
    >
      <div className="activity-entry-main transcript-entry-main" onClick={onSelect}>
        <div className="activity-entry-meta">
          <button
            type="button"
            className="activity-time activity-time-range"
            aria-pressed={selected}
            aria-label={`${t("recording.transcriptActivity")} ${range}`}
            title={range}
          >
            {formatPlayerTime(entry.segment.startMs / 1_000)}
          </button>
          <span className="activity-meta-separator" aria-hidden="true">
            -
          </span>
          <button
            type="button"
            className="activity-type-badge activity-type-badge-transcript"
            aria-pressed={selected}
          >
            {t("recording.filterSpeech")}
          </button>
        </div>
        <span
          className="activity-dialogue-editor"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={t("recording.editDialogue")}
          onFocus={onFocusActivity}
          onClick={(event) => event.stopPropagation()}
          onBlur={(event) => onSave(event.currentTarget.innerText, event.currentTarget)}
        >
          {entry.segment.text}
        </span>
      </div>
      <div className="activity-actions">
        <ActivityActionMenu
          onRemove={onRemove}
          removeLabel={t("recording.removeDialogue")}
          removeDisabled={pending}
        />
      </div>
    </li>
  );
}
