import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import type {
  RecordingRepository,
  StoredTimelineImport,
  TimelineImportRepository,
} from "@path/database";
import type {
  RecordingTimelineImports,
  TimelineImport,
  TimelineImportFileResult,
  TimelineImportKind,
} from "@path/shared";
import {
  alignTimelineRows,
  parseTimelineImport,
  recordingTimeWindow,
  resolveMediaTiming,
  type ResolvedMediaTiming,
} from "@path/timeline";
import type { DesktopSettingsService } from "../settings/DesktopSettingsService";

const BYTES_PER_MB = 1024 * 1024;

interface AlignmentContext {
  resolved: ResolvedMediaTiming;
  durationMs: number;
}

/** An aligned imported row supplied to document generation as evidence. */
export interface DocumentTimelineEntry {
  kind: TimelineImportKind;
  timestampMs: number;
  text: string;
}

/** Imports log and element files and aligns their wall-clock rows to a recording's media time. */
export class TimelineImportService {
  constructor(
    private readonly recordings: RecordingRepository,
    private readonly imports: TimelineImportRepository,
    private readonly settings: Pick<DesktopSettingsService, "get">,
  ) {}

  async list(recordingId: string): Promise<RecordingTimelineImports> {
    const context = await this.alignmentContext(recordingId);

    if (!context) return { window: null, log: null, element: null };

    const [log, element] = await Promise.all([
      this.imports.get(recordingId, "log"),
      this.imports.get(recordingId, "element"),
    ]);

    return {
      window: recordingTimeWindow(context.resolved, context.durationMs),
      log: log ? toTimelineImport(log, context) : null,
      element: element ? toTimelineImport(element, context) : null,
    };
  }

  /** Validates the recording before asking for a file, then enforces the configured size limit. */
  async importFile(
    recordingId: string,
    kind: TimelineImportKind,
    chooseFile: () => Promise<string | null>,
  ): Promise<TimelineImportFileResult> {
    const context = await this.requireAlignmentContext(recordingId);
    const filePath = await chooseFile();

    if (!filePath) return { status: "canceled" };

    const { maxFileSizeMb } = this.settings.get().timelineImports;
    const file = await stat(filePath);

    if (!file.isFile()) throw new Error("The selected path is not a file");
    if (file.size > maxFileSizeMb * BYTES_PER_MB) return { status: "too-large", maxFileSizeMb };

    const content = await readFile(filePath, "utf8");
    const parsed = parseTimelineImport(
      content,
      kind,
      Date.parse(context.resolved.timing.startedAt),
    );

    if (parsed.rows.length === 0) return { status: "no-rows" };

    // Rows outside the video are kept so a later offset change can bring them into range.
    const stored = await this.imports.replace({
      recordingId,
      kind,
      fileName: basename(filePath),
      unreadableLineCount: parsed.unreadableLineCount,
      rows: parsed.rows,
    });

    return { status: "imported", timelineImport: toTimelineImport(stored, context) };
  }

  async updateOffset(
    recordingId: string,
    kind: TimelineImportKind,
    offsetMs: number,
  ): Promise<TimelineImport> {
    const context = await this.requireAlignmentContext(recordingId);
    const stored = await this.imports.updateOffset(recordingId, kind, offsetMs);

    return toTimelineImport(stored, context);
  }

  async remove(recordingId: string, kind: TimelineImportKind): Promise<void> {
    await this.imports.remove(recordingId, kind);
  }

  async documentEntries(recordingId: string): Promise<DocumentTimelineEntry[]> {
    const { log, element } = await this.list(recordingId);

    return [log, element].flatMap((timelineImport) =>
      timelineImport
        ? timelineImport.entries.map((entry) => ({
            kind: timelineImport.kind,
            timestampMs: entry.timestampMs,
            text: entry.text,
          }))
        : [],
    );
  }

  private async alignmentContext(recordingId: string): Promise<AlignmentContext | null> {
    const session = await this.recordings.get(recordingId);

    if (!session) throw new Error(`Recording not found: ${recordingId}`);
    if (session.durationMs === null) return null;

    // Click times only matter when estimating timing for an older recording.
    const clicks = session.mediaTiming ? [] : await this.recordings.listClicks(recordingId);

    return { resolved: resolveMediaTiming(session, clicks), durationMs: session.durationMs };
  }

  private async requireAlignmentContext(recordingId: string): Promise<AlignmentContext> {
    const context = await this.alignmentContext(recordingId);

    if (!context) throw new Error("The recording has no video duration to align imported rows");

    return context;
  }
}

function toTimelineImport(stored: StoredTimelineImport, context: AlignmentContext): TimelineImport {
  const { entries, outsideCount } = alignTimelineRows(
    stored.rows,
    context.resolved.timing,
    context.durationMs,
    stored.offsetMs,
  );

  return {
    kind: stored.kind,
    fileName: stored.fileName,
    offsetMs: stored.offsetMs,
    importedAt: stored.importedAt,
    entries,
    outsideCount,
    unreadableLineCount: stored.unreadableLineCount,
  };
}
