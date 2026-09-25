import { stat } from "node:fs/promises";
import { basename } from "node:path";
import type { StoredTimelineImport, TimelineRowRange } from "@path/database";
import type {
  RecordingMediaTiming,
  RecordingTimelineImports,
  TimelineImport,
  TimelineImportEntry,
  TimelineImportFileResult,
  TimelineImportKind,
  TimelineImportRowsPage,
} from "@path/shared";
import {
  alignedWallClockRange,
  alignTimelineRow,
  latestWallClockAtMediaMs,
  recordingTimeWindow,
} from "@path/timeline";
import type { RemoteRepositories, TimelineFileImporter } from "../storage/DatabaseClient";
import type { DesktopSettingsService } from "../settings/DesktopSettingsService";

const BYTES_PER_MB = 1024 * 1024;

interface AlignmentContext {
  timing: RecordingMediaTiming;
  durationMs: number;
}

/** An aligned imported row supplied to document generation as evidence. */
export interface DocumentTimelineEntry {
  kind: TimelineImportKind;
  timestampMs: number;
  text: string;
}

/**
 * Imports log and element files and aligns their wall-clock rows to a recording's media time.
 * Rows stay in SQLite; renderers read summaries and pages, never a whole import.
 */
export class TimelineImportService {
  constructor(
    private readonly repositories: Pick<RemoteRepositories, "recordings" | "timelineImports">,
    private readonly importer: TimelineFileImporter,
    private readonly settings: Pick<DesktopSettingsService, "get">,
  ) {}

  async list(recordingId: string): Promise<RecordingTimelineImports> {
    const context = await this.alignmentContext(recordingId);

    if (!context) return { window: null, log: null, element: null };

    const [log, element] = await Promise.all([
      this.repositories.timelineImports.getReady(recordingId, "log"),
      this.repositories.timelineImports.getReady(recordingId, "element"),
    ]);

    return {
      window: recordingTimeWindow(context.timing, context.durationMs),
      log: log ? await this.summarize(log, context) : null,
      element: element ? await this.summarize(element, context) : null,
    };
  }

  /**
   * Validates the recording before asking for a file, checks the configured size limit, then
   * streams the file into the database worker. The main process never holds the file's contents.
   */
  async importFile(
    recordingId: string,
    kind: TimelineImportKind,
    chooseFile: () => Promise<string | null>,
  ): Promise<TimelineImportFileResult> {
    const context = await this.requireAlignmentContext(recordingId);
    const filePath = await chooseFile();

    if (!filePath) return { status: "canceled" };

    const { maxFileSizeMb } = this.settings.get().timelineImports;
    const maxBytes = maxFileSizeMb * BYTES_PER_MB;
    const file = await stat(filePath);

    if (!file.isFile()) throw new Error("The selected path is not a file");
    if (file.size > maxBytes) return { status: "too-large", maxFileSizeMb };

    // Rows outside the video are kept so a later offset change can bring them into range.
    const outcome = await this.importer.importTimelineFile({
      recordingId,
      kind,
      filePath,
      fileName: basename(filePath),
      referenceMs: Date.parse(context.timing.startedAt),
      maxBytes,
    });

    if (outcome.status === "too-large") return { status: "too-large", maxFileSizeMb };
    if (outcome.status === "no-rows") return { status: "no-rows" };

    return {
      status: "imported",
      timelineImport: await this.summarize(outcome.timelineImport, context),
    };
  }

  /** One page of rows inside the video, optionally filtered, in chronological order. */
  async listRows(
    recordingId: string,
    kind: TimelineImportKind,
    start: number,
    limit: number,
    query?: string,
  ): Promise<TimelineImportRowsPage> {
    const { stored, context } = await this.requireImport(recordingId, kind);
    const range = this.rowRange(stored, context, query);
    const [total, rows] = await Promise.all([
      this.repositories.timelineImports.countRows(range),
      this.repositories.timelineImports.listRows(range, start, limit),
    ]);

    return { start, total, entries: this.align(rows, stored, context) };
  }

  /** Index of the last matching row at or before a media time, or -1 when none precedes it. */
  async locateRow(
    recordingId: string,
    kind: TimelineImportKind,
    timestampMs: number,
    query?: string,
  ): Promise<number> {
    const { stored, context } = await this.requireImport(recordingId, kind);
    const range = this.rowRange(stored, context, query);
    const latestMs = latestWallClockAtMediaMs(context.timing, timestampMs) - stored.offsetMs;

    if (latestMs < range.startMs) return -1;

    const rowsAtOrBefore = await this.repositories.timelineImports.countRows({
      ...range,
      endMs: Math.min(range.endMs, latestMs),
    });

    return rowsAtOrBefore - 1;
  }

  async updateOffset(
    recordingId: string,
    kind: TimelineImportKind,
    offsetMs: number,
  ): Promise<TimelineImport> {
    const context = await this.requireAlignmentContext(recordingId);
    const stored = await this.repositories.timelineImports.updateOffset(
      recordingId,
      kind,
      offsetMs,
    );

    return this.summarize(stored, context);
  }

  async remove(recordingId: string, kind: TimelineImportKind): Promise<void> {
    await this.repositories.timelineImports.remove(recordingId, kind);
  }

  /**
   * Evidence for document generation, sampled evenly across every row inside the video after
   * each import's offset. It never depends on which page a renderer has loaded. Kinds share the
   * budget equally, and a kind with fewer rows passes its unused share on, so a dense log cannot
   * crowd out sparse element evidence.
   */
  async documentEntries(recordingId: string, limit: number): Promise<DocumentTimelineEntry[]> {
    const context = await this.alignmentContext(recordingId);

    if (!context) return [];

    const imports = (
      await Promise.all([
        this.repositories.timelineImports.getReady(recordingId, "log"),
        this.repositories.timelineImports.getReady(recordingId, "element"),
      ])
    ).filter((stored): stored is StoredTimelineImport => stored !== null);

    const counts = await Promise.all(
      imports.map((stored) =>
        this.repositories.timelineImports.countRows(this.rowRange(stored, context)),
      ),
    );

    const quotas = shareEvidenceBudget(counts, limit);
    const samples = await Promise.all(
      imports.map(async (stored, index) => {
        const quota = quotas[index] ?? 0;
        const rows =
          quota === 0
            ? []
            : await this.repositories.timelineImports.sampleRows(
                this.rowRange(stored, context),
                quota,
              );

        return this.align(rows, stored, context).map((entry) => ({
          kind: stored.kind,
          timestampMs: entry.timestampMs,
          text: entry.text,
        }));
      }),
    );

    return samples.flat();
  }

  private async summarize(
    stored: StoredTimelineImport,
    context: AlignmentContext,
  ): Promise<TimelineImport> {
    const entryCount = await this.repositories.timelineImports.countRows(
      this.rowRange(stored, context),
    );

    return {
      kind: stored.kind,
      fileName: stored.fileName,
      offsetMs: stored.offsetMs,
      importedAt: stored.importedAt,
      rowCount: stored.rowCount,
      entryCount,
      outsideCount: stored.rowCount - entryCount,
      unreadableLineCount: stored.unreadableLineCount,
    };
  }

  /** Stored rows keep original times, so the video's range is shifted by the import's offset. */
  private rowRange(
    stored: StoredTimelineImport,
    context: AlignmentContext,
    query?: string,
  ): TimelineRowRange {
    const { startMs, endMs } = alignedWallClockRange(context.timing, context.durationMs);

    return {
      importId: stored.id,
      startMs: startMs - stored.offsetMs,
      endMs: endMs - stored.offsetMs,
      ...(query ? { query } : {}),
    };
  }

  private align(
    rows: { id: number; occurredAtMs: number; text: string }[],
    stored: StoredTimelineImport,
    context: AlignmentContext,
  ): TimelineImportEntry[] {
    return rows
      .map((row) => alignTimelineRow(row, context.timing, context.durationMs, stored.offsetMs))
      .filter((entry): entry is TimelineImportEntry => entry !== null);
  }

  private async requireImport(
    recordingId: string,
    kind: TimelineImportKind,
  ): Promise<{ stored: StoredTimelineImport; context: AlignmentContext }> {
    const context = await this.requireAlignmentContext(recordingId);
    const stored = await this.repositories.timelineImports.getReady(recordingId, kind);

    if (!stored) throw new Error(`No ${kind} import exists for this recording`);

    return { stored, context };
  }

  /** Imports align only after capture stops and media timing and duration are stored. */
  private async alignmentContext(recordingId: string): Promise<AlignmentContext | null> {
    const session = await this.repositories.recordings.get(recordingId);

    if (!session) throw new Error(`Recording not found: ${recordingId}`);
    if (session.durationMs === null || !session.mediaTiming) return null;

    return { timing: session.mediaTiming, durationMs: session.durationMs };
  }

  private async requireAlignmentContext(recordingId: string): Promise<AlignmentContext> {
    const context = await this.alignmentContext(recordingId);

    if (!context) throw new Error("The recording has no video duration to align imported rows");

    return context;
  }
}

/** Splits a row budget between sources, smallest first, so every source keeps its fair share. */
function shareEvidenceBudget(counts: number[], limit: number): number[] {
  const quotas = counts.map(() => 0);
  const order = counts
    .map((_, index) => index)
    .sort((left, right) => (counts[left] ?? 0) - (counts[right] ?? 0));

  let remaining = limit;

  for (const [position, index] of order.entries()) {
    const share = Math.floor(remaining / (order.length - position));

    quotas[index] = Math.min(counts[index] ?? 0, share);
    remaining -= quotas[index] ?? 0;
  }

  return quotas;
}
