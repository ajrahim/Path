// Benchmark entry bundled and run by MeasurePersistence.mjs under Node or Electron. It drives the
// real desktop storage code: the database worker, the streaming import job, paged timeline
// queries, and document history. Results are written as JSON to the path in the options.
import { randomUUID } from "node:crypto";
import { createWriteStream, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { serialize } from "node:v8";
import { TimelineImportService } from "../src/recording/TimelineImportService.ts";
import { DatabaseClient } from "../src/storage/DatabaseClient.ts";

const options = JSON.parse(process.env.PATH_APP_BENCHMARK ?? "{}");
const MEDIA_STARTED_AT = "2026-09-14T10:00:00.000Z";
const VIDEO_DURATION_MS = 60 * 60 * 1_000;

function megabytes(bytes) {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);

  return Math.round((sorted[Math.floor((sorted.length - 1) * fraction)] ?? 0) * 100) / 100;
}

/** Records main-thread stalls and process memory while a workload runs. */
function startMonitor() {
  const delay = monitorEventLoopDelay({ resolution: 5 });
  let lastTick = performance.now();
  let maxGapMs = 0;
  let peakRss = process.memoryUsage().rss;
  let peakHeap = process.memoryUsage().heapUsed;

  delay.enable();

  const heartbeat = setInterval(() => {
    const now = performance.now();
    const usage = process.memoryUsage();

    maxGapMs = Math.max(maxGapMs, now - lastTick);
    lastTick = now;
    peakRss = Math.max(peakRss, usage.rss);
    peakHeap = Math.max(peakHeap, usage.heapUsed);
  }, 2);

  return async () => {
    // Let a delayed tick land before reading, so a final stall is counted.
    await new Promise((resolve) => setTimeout(resolve, 20));
    clearInterval(heartbeat);
    delay.disable();

    return {
      mainThreadMaxStallMs: Math.round(maxGapMs),
      eventLoopDelayP99Ms: Math.round(delay.percentile(99) / 1e6),
      peakProcessRssMb: megabytes(peakRss),
      peakMainHeapMb: megabytes(peakHeap),
    };
  };
}

async function timed(action) {
  const started = performance.now();
  const value = await action();

  return { value, ms: Math.round((performance.now() - started) * 100) / 100 };
}

async function writeSyntheticLog(path, rows) {
  const stream = createWriteStream(path);
  const startMs = Date.parse(MEDIA_STARTED_AT);
  // Rows span two hours around a one-hour video, so about half fall inside it.
  const spanMs = 2 * VIDEO_DURATION_MS;

  for (let index = 0; index < rows; index += 1) {
    const at = new Date(startMs - VIDEO_DURATION_MS / 2 + Math.floor((index / rows) * spanMs));
    let line = `${at.toISOString()} INFO [worker-${index % 16}] request ${index} handled path=/api/items/${index % 977} status=200 durationMs=${index % 311}\n`;

    if (index % 50 === 0) line += `    at handler (src/server/Handler.ts:${index % 400}:12)\n`;
    if (!stream.write(line)) await new Promise((resolve) => stream.once("drain", resolve));
  }

  await new Promise((resolve) => stream.end(resolve));
}

async function createRecording(client, directory) {
  const id = randomUUID();
  const root = await client.repositories.storageRoots.register(join(directory, "media"));

  await client.repositories.recordings.create({
    id,
    storageRootId: root.id,
    title: "Benchmark",
    captureMode: "display",
    startedAt: MEDIA_STARTED_AT,
  });
  await client.repositories.recordings.recordMediaTiming(id, {
    startedAt: MEDIA_STARTED_AT,
    pauses: [],
  });
  await client.repositories.recordings.markProcessing(id, VIDEO_DURATION_MS, "recording.webm");

  return id;
}

async function measureImport(client, directory) {
  const logPath = join(directory, "synthetic.log");

  await writeSyntheticLog(logPath, options.rows);

  const recordingId = await createRecording(client, directory);
  const service = new TimelineImportService(client.repositories, client, {
    get: () => ({ timelineImports: { maxFileSizeMb: 200 } }),
  });

  const stop = startMonitor();
  const imported = await timed(() => service.importFile(recordingId, "log", async () => logPath));
  const importMonitor = await stop();

  const summary = imported.value.timelineImport;
  const middle = Math.floor(summary.entryCount / 2);
  const last = Math.max(0, summary.entryCount - 200);
  const queryMonitorStop = startMonitor();
  const firstPage = await timed(() => service.listRows(recordingId, "log", 0, 200));
  const middlePage = await timed(() => service.listRows(recordingId, "log", middle, 200));
  const lastPage = await timed(() => service.listRows(recordingId, "log", last, 200));
  const filteredFirst = await timed(() =>
    service.listRows(recordingId, "log", 0, 200, "items/976"),
  );

  const filteredNext = await timed(() =>
    service.listRows(recordingId, "log", 200, 200, "items/976"),
  );

  const locate = await timed(() => service.locateRow(recordingId, "log", VIDEO_DURATION_MS / 2));
  const reselect = await timed(() => service.list(recordingId));
  const evidence = await timed(() => service.documentEntries(recordingId, 200));
  const offset = await timed(() => service.updateOffset(recordingId, "log", 90_000));
  const queryMonitor = await queryMonitorStop();

  return {
    fileMb: megabytes(statSync(logPath).size),
    storedRows: summary.rowCount,
    rowsInsideVideo: summary.entryCount,
    importMs: imported.ms,
    ...importMonitor,
    firstPageMs: firstPage.ms,
    middlePageMs: middlePage.ms,
    lastPageMs: lastPage.ms,
    pageIpcBytes: serialize(firstPage.value).byteLength,
    filteredFirstPageMs: filteredFirst.ms,
    filteredMatches: filteredFirst.value.total,
    filteredNextPageMs: filteredNext.ms,
    locatePlayheadMs: locate.ms,
    reselectSummaryMs: reselect.ms,
    reselectIpcBytes: serialize(reselect.value).byteLength,
    generationEvidenceMs: evidence.ms,
    generationEvidenceRows: evidence.value.length,
    offsetChangeMs: offset.ms,
    queryMainThreadMaxStallMs: queryMonitor.mainThreadMaxStallMs,
  };
}

async function measureDocuments(client, directory) {
  const recordingId = await createRecording(client, directory);
  const documents = client.repositories.documents;
  const base = "# Guide\n\n" + "A paragraph of guide text that explains one step.\n".repeat(160);
  const saveTimes = [];
  const draftTimes = [];
  let savedNumber = null;
  let draftVersion = 0;

  for (let index = 0; index < options.revisions; index += 1) {
    const markdown = `${base}\nRevision ${index}\n`;
    const draft = await timed(() =>
      documents.saveDraft(recordingId, `${markdown}typing`, draftVersion),
    );

    draftTimes.push(draft.ms);
    draftVersion = draft.value.draftVersion;

    const saved = await timed(() =>
      documents.save(recordingId, markdown, savedNumber, draftVersion),
    );

    saveTimes.push(saved.ms);
    savedNumber = saved.value.revision.number;
    draftVersion = saved.value.draftVersion;
  }

  const firstPage = await timed(() => documents.listRevisions(recordingId));
  const oldest = await timed(() => documents.getRevision(recordingId, 1));
  const snapshot = await timed(() => documents.getSnapshot(recordingId));
  const restored = await timed(() => documents.restoreRevision(recordingId, 1, "# Unsaved"));

  return {
    revisions: options.revisions,
    documentKb: Math.round(Buffer.byteLength(base) / 1024),
    saveP50Ms: percentile(saveTimes, 0.5),
    saveP95Ms: percentile(saveTimes, 0.95),
    draftP50Ms: percentile(draftTimes, 0.5),
    draftP95Ms: percentile(draftTimes, 0.95),
    listNewestPageMs: firstPage.ms,
    readOldestRevisionMs: oldest.ms,
    openSnapshotMs: snapshot.ms,
    restoreMs: restored.ms,
  };
}

/** Saves of a document with an embedded screenshot, measured in their own database file. */
async function measureImageDocuments(directory) {
  const databasePath = join(directory, "images.sqlite");
  const client = await DatabaseClient.open({
    workerPath: options.workerPath,
    databasePath,
    migrationsFolder: options.migrationsFolder,
  });

  const recordingId = await createRecording(client, directory);
  // Each save repeats the same large data URL, as a pasted screenshot does.
  const image = `data:image/png;base64,${"iVBORw0KGgoAAAANSUhEUgAA".repeat(21_000)}=`;
  let savedNumber = null;
  let draftVersion = 0;
  let markdownBytes = 0;

  for (let index = 0; index < options.imageRevisions; index += 1) {
    const markdown = `# Guide ${index}\n\n![Step](${image})\n\nStep ${index} text.`;
    const result = await client.repositories.documents.save(
      recordingId,
      markdown,
      savedNumber,
      draftVersion,
    );

    markdownBytes += Buffer.byteLength(markdown);
    savedNumber = result.revision.number;
    draftVersion = result.draftVersion;
  }

  await client.close(30_000);

  return {
    revisions: options.imageRevisions,
    imageKb: Math.round(image.length / 1024),
    markdownTotalMb: megabytes(markdownBytes),
    databaseFileMb: megabytes(statSync(databasePath).size),
  };
}

async function run() {
  const opened = await timed(() =>
    DatabaseClient.open({
      workerPath: options.workerPath,
      databasePath: options.databasePath,
      migrationsFolder: options.migrationsFolder,
    }),
  );

  const client = opened.value;
  const results = {
    runtime: process.versions.electron
      ? `electron ${process.versions.electron}`
      : `node ${process.version}`,
    firstLaunchOpenMs: opened.ms,
    import: await measureImport(client, options.directory),
    documents: await measureDocuments(client, options.directory),
    imageDocuments: await measureImageDocuments(options.directory),
  };

  const closed = await timed(() => client.close(30_000));

  results.closeMs = closed.ms;
  results.databaseMb = megabytes(statSync(options.databasePath).size);
  writeFileSync(options.output, JSON.stringify(results, null, 2));
}

async function main() {
  if (process.versions.electron) {
    const { app } = await import("electron");

    await app.whenReady();
    await run().then(
      () => app.exit(0),
      (error) => {
        console.error(error);
        app.exit(1);
      },
    );

    return;
  }

  await run();
}

void main();
