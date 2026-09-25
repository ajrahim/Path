import { createReadStream } from "node:fs";
import type { DatabaseRepositories } from "@path/database";
import { TimelineImportParser, type ParsedTimelineRow } from "@path/timeline";
import type { TimelineFileImportJob, TimelineFileImportOutcome } from "./DatabaseWorkerProtocol";

// Each batch commits separately, so other database requests can run between batches.
const STAGING_BATCH_ROWS = 5_000;
const READ_CHUNK_BYTES = 256 * 1024;

/**
 * Streams a chosen file through the incremental parser into a staging import, then promotes it
 * in one transaction. Memory stays bounded by one chunk and one batch, and the previous import
 * remains visible until the replacement commits. Runs inside the database worker.
 */
export async function runTimelineFileImport(
  repositories: Pick<DatabaseRepositories, "timelineImports">,
  job: TimelineFileImportJob,
): Promise<TimelineFileImportOutcome> {
  const imports = repositories.timelineImports;
  const importId = imports.beginStaging(job.recordingId, job.kind, job.fileName);
  const parser = new TimelineImportParser(job.kind, job.referenceMs);
  let batch: ParsedTimelineRow[] = [];
  let storedRowCount = 0;

  const addRow = (row: ParsedTimelineRow | null) => {
    if (!row) return;

    batch.push(row);
    if (batch.length >= STAGING_BATCH_ROWS) flushBatch();
  };

  const flushBatch = () => {
    if (batch.length === 0) return;

    imports.appendStagingRows(importId, batch);
    storedRowCount += batch.length;
    batch = [];
  };

  try {
    const stream = createReadStream(job.filePath, { highWaterMark: READ_CHUNK_BYTES });
    // The decoder drops a leading byte-order mark and keeps multi-byte characters split
    // across chunk boundaries intact.
    const decoder = new TextDecoder("utf-8");
    let bytesRead = 0;
    let partialLine = "";

    for await (const chunk of stream as AsyncIterable<Buffer>) {
      bytesRead += chunk.length;

      // The file may have grown after the main process checked its size.
      if (bytesRead > job.maxBytes) {
        stream.destroy();
        imports.discardStaging(importId);

        return { status: "too-large" };
      }

      const lines = (partialLine + decoder.decode(chunk, { stream: true })).split("\n");

      partialLine = lines.pop() ?? "";

      for (const line of lines) addRow(parser.addLine(line));
    }

    addRow(parser.addLine(partialLine + decoder.decode()));
    addRow(parser.finish());
    flushBatch();

    if (storedRowCount === 0) {
      imports.discardStaging(importId);

      return { status: "no-rows" };
    }

    return {
      status: "imported",
      timelineImport: imports.promoteStaging(importId, parser.unreadableLineCount),
    };
  } catch (error) {
    // A failed read or write never becomes visible; the previous import stays in place.
    try {
      imports.discardStaging(importId);
    } catch {
      // Startup recovery removes staging rows that could not be discarded here.
    }

    throw error;
  }
}
