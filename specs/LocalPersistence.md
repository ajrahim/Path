# Local persistence

Status: Active

## Goal

Every durable kind of Path data has one storage owner and survives restarts, crashes, and quits: recordings and their assets, projects, transcripts and clicks, imported logs and elements, guide documents with recoverable drafts and revision history, and settings, prompts, and model/CLI selections. Storage work never blocks the Electron main thread.

## Storage ownership

| Data                                                | Owner                                                                | Location                                                                                                                        |
| --------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Recording metadata, media timing, storage root      | `RecordingRepository`, `StorageRootRepository`                       | `recordings`, `storage_roots`                                                                                                   |
| Video, audio, thumbnails, click screenshots         | `ManagedRecordingAssets`                                             | `<storage root>/<recording id>/`; paths in SQLite are validated against registered roots                                        |
| Projects and membership                             | `ProjectRepository`                                                  | `projects`, `project_recordings`                                                                                                |
| Transcript segments and clicks                      | `RecordingRepository`                                                | `transcript_segments`, `click_events`                                                                                           |
| Imported log and element rows                       | `TimelineImportRepository`                                           | `timeline_imports`, `timeline_import_entries` (original wall-clock times plus a per-import offset)                              |
| Documents, recovery drafts, revisions, their images | `DocumentRepository`                                                 | `documents`, `document_drafts`, `document_revisions`, `document_images`                                                         |
| Settings, prompt library, CLI and model selections  | `DesktopSettingsService`, `InstructionFlowService`, `CliToolService` | `app_settings` JSON rows, validated by their owners                                                                             |
| Files waiting to be deleted                         | `AssetDeletionQueue`                                                 | `asset_deletions`                                                                                                               |
| Provider API keys                                   | `AiCredentialStore`                                                  | `credentials/ai-providers.json`, encrypted with Electron `safeStorage`; never in SQLite, settings JSON, logs, or renderer state |
| Theme                                               | `next-themes`                                                        | Renderer `localStorage`; it must be read before first paint                                                                     |
| Application diagnostics                             | `DiagnosticLog`                                                      | `logs/main.log` and rotated files                                                                                               |

Renderer windows hold loaded summaries, pages, and editor state in hooks and Redux slices. They never load a whole import or the whole database, and nothing is persisted from Redux to browser storage.

## Requirements

### Database worker

- One `worker_threads` worker (`DatabaseWorker`) owns the only SQLite connection. The main process uses typed repository stand-ins from `DatabaseClient`; every call crosses the thread boundary, and repository methods are synchronous inside the worker.
- Requests run one at a time in arrival order, so a transaction never interleaves with another request. Streaming imports are the only asynchronous work and commit in batches.
- Startup waits until migrations and recovery finish. If the database cannot be opened, Path shows the error and the database path, and quits without changing the file.
- If the worker stops unexpectedly, pending and later requests fail with `DatabaseUnavailableError`, the failure is logged, and the user is offered a restart.
- Orderly quit waits for renderer draft flushes (2 s limit), pending click writes, and in-flight database work, then closes the connection. The worker exits on its own; forced termination is used only after the 10 s limit.
- The connection uses WAL, `synchronous = FULL` (an acknowledged commit is durable), foreign keys, and a busy timeout.

### Schema and initialization

- `0000_baseline.sql` is the schema for fresh installations; later changes add migrations.
- First launch creates the user-data directories (logs, models, credentials, CLI work), the database, and the default recordings root. Reopening never resets data.
- A database whose applied migrations are not in the shipped folder is rejected before anything writes to it. `npm run db:reset -- --confirm` moves such a development database into `backups/` without deleting it.
- Recordings reference the root they were captured in. Changing the recordings location registers a new root, and recordings in earlier roots keep working.

### Documents, drafts, and revisions

- The editor opens with the recovery draft when one exists, otherwise the saved document. A draft exists only while the text differs from the last explicit save, and it never counts as saved.
- Edits write a recovery draft 1 s after typing stops, and immediately before generation, updates, restores, a recording switch, and quit. Keystrokes do not create revisions.
- Durable revisions are appended for successful generation (`generated`), AI updates (`ai-update`), explicit saves (`saved`), restores (`restored`), and unsaved text replaced by any of those (`checkpoint`). Content equal to the latest revision is not duplicated, and a checkpoint is skipped when history already has the text.
- Revisions are full snapshots. Embedded data-URL images of 1 KB or more are stored once per document and referenced from revisions.
- Restoring appends the chosen revision as a new revision; earlier history is kept.
- The editor footer shows the version the text came from (for example `Version 3`) in a borderless picker that lists every version with its type and time, and a second line such as `Last saved 2 days ago`. Unsaved text reads `Unsaved changes · last saved …`; a recovery draft never changes the saved time.
- Explicit saves carry the saved revision the editor loaded, and drafts carry the draft version. Stale requests are rejected and the editor keeps its text. Saving again after a save conflict deliberately replaces the newer save, which stays in history. After a draft conflict autosave stops until the user saves.
- An AI result is committed to history before it returns. It replaces the editor text only if the text did not change while the request ran; otherwise it stays in history and the user is told.
- A save resolves only after its transaction commits. Discarding changes deletes the draft.
- Committed changes are broadcast. Other windows refresh their history, and a window with no unsaved text follows a newer save.

### Imports, activity, and files

- An import is streamed and parsed line by line in the worker, into a staging import in 5,000-row transactions, and then swapped in by one transaction. The previous import stays visible until the swap, and staging rows left by a crash are removed at startup. The size limit is also enforced while reading.
- Renderers read import summaries, pages of at most 500 rows, case-insensitive substring search in the desktop (ASCII letters fold case), and a playhead lookup. Rows outside the current video window remain stored.
- Document generation samples evenly across every stored row inside the video after each import's offset, independent of any page. It keeps the 200-row budget, and each kind keeps a fair share of it.
- Clicks are written in ordered transactional batches with bounded retries. At most 8 screenshots are pending; further clicks are stored without a screenshot rather than dropped. Clicks that still cannot be stored are reported when capture stops.
- Deleting a recording or click records its files in `asset_deletions` in the same transaction. Files are removed afterwards and retried at the next startup. Only `<registered root>/<recording id>` directories and files inside registered roots are ever removed.
- Transcript replacement is atomic.
- Diagnostics rotate at 1 MB, keep 5 files, and drop files older than 14 days. Retention never applies to imports or document history.

## Acceptance Criteria

- [x] First launch creates the database and data directories; reopening keeps data (`Connection`, `UserDataDirectory`, `DatabaseClient` tests; packaged launch).
- [x] Documents, drafts, revisions, settings, prompts, projects, and activity survive a restart (`DocumentRepository`, `DesktopSettingsService`, `InstructionFlowService`, `ProjectRepository`, `RecordingRepository`, `DatabaseClient` tests).
- [x] Restoring creates a new revision; stale saves and drafts are rejected without losing text (`DocumentRepository`, `GuideDocumentService`, `GuideDocumentHooks`, `GuidePaneHistory` tests).
- [x] Import replacement is atomic, and offsets re-align stored rows (`TimelineImportRepository`, `TimelineImportService` tests).
- [x] Paging, filtering, locating, and full-window generation evidence are correct (`TimelineImportService`, `TimelineImportPanel`, `MediaTiming` tests).
- [x] Click queue limits, write retries, failure reporting, and flushing behave as specified (`ClickCaptureCoordinator` tests).
- [x] IPC input is validated, and asset deletion stays inside managed roots (`DocumentIpc`, `ManagedRecordingAssets`, `AssetDeletionQueue` tests).
- [x] Interrupted imports, unexpected worker stops, corrupt or foreign databases, and missing migrations leave data intact (`DatabaseClient`, `Connection` tests).
- [x] Storage work keeps the main thread responsive under a 1,000,000-row import (`npm run measure:persistence`).
- [ ] Interactive check of draft recovery, history preview, compare, and restore in the running desktop app.

## Constraints

- The renderer has no SQL, filesystem, or credential access; everything goes through the typed preload bridge with strict schemas.
- No legacy migration: this is a fresh-installation baseline. Earlier prompt migration from renderer storage, single-model settings fallback, and approximate timing for recordings without media timing were removed.

## Out of Scope

- Cloud sync, multi-device storage, or encryption of the SQLite file.
- Merging concurrent edits; conflicts are detected and resolved by an explicit save.
- Diff-based revision storage and automatic history pruning.
- Moving the theme preference into SQLite.

## Source Ownership

`packages/database` owns the schema, `0000_baseline` migration, connection, and repositories. `apps/desktop/src/storage` owns the worker (`DatabaseWorker`, `DatabaseWorkerProtocol`, `DatabaseClient`, `TimelineImportJob`), `ManagedRecordingAssets`, `AssetDeletionQueue`, `DiagnosticLog`, and `UserDataDirectory`. `GuideDocumentService` owns document generation and persistence, and `StartupRecovery` owns launch recovery. `RendererFlush` and `Main` own quit ordering. In the renderer, `useGuideDocument` owns editor state, draft debouncing, and history; `useTimelineImportRows` owns paged import rows; `GuidePane` and `GuideRevisionCompare` present them.

## Verification

Verified on 2026-09-24:

- `npm test`: 515 tests, 509 pass. The 6 failures predate this change and are unrelated (`OllamaClickActionAnalyzer` 1, `RecordingProjectsUi` 2, `RecordingRenameUi` 3). They fail identically on the pre-change tree.
- Typecheck, dependency-cruiser, and Knip pass. ESLint and Prettier report only issues that predate this change, in `HistorySidebar.tsx`, `HistorySidebar.test.tsx`, `InstructionFlowIconSelect.tsx`, and `OllamaClickActionAnalyzer.test.ts`.
- `npm run build` and `node tests/RendererPages.mjs` pass.
- `npm run package:dir` built an app whose worker loads from `app.asar` with the unpacked native module. Launched with an isolated profile, it created the database and directories. After a forced kill and a relaunch, it kept one migration entry and one storage root, with no diagnostics errors.
- `npm run measure:persistence` results for Node and Electron 42 are recorded in [the measurement notes](#measurements).

### Measurements

Synthetic log: 1,000,000 rows, 105.6 MB, with about half the rows inside a one-hour video. Every run used the same machine.

| Workload                                     | Before (main thread)           | After, Node                                               | After, Electron 42     |
| -------------------------------------------- | ------------------------------ | --------------------------------------------------------- | ---------------------- |
| Import 1,000,000 rows                        | 8.0 s, all on the main thread  | 6.4 s in the worker                                       | 5.5 s in the worker    |
| Longest main-thread stall during import      | 9,125 ms                       | 18 ms                                                     | 17 ms                  |
| Peak process memory during import            | 1,260 MB RSS                   | 410 MB                                                    | 286 MB                 |
| Data sent to a renderer after import         | 76.1 MB (every aligned row)    | 263 B summary + 31 KB per 200-row page                    | same                   |
| Reselecting the recording                    | 1,171 ms main-thread block     | 0.5 ms summary; 2 / 16 / 23 ms first / middle / last page | 0.9 ms; 2 / 15 / 21 ms |
| Search (512 matches)                         | in-renderer filter of all rows | 155 ms first page, 85 ms next                             | 156 ms, 87 ms          |
| Playhead lookup                              | in-renderer                    | 14 ms                                                     | 14 ms                  |
| Generation evidence (200 rows)               | aligned all rows on main       | 253 ms in the worker                                      | 244 ms                 |
| Save / draft, 8 KB document, 1,000 revisions | —                              | p50 0.69 / 0.53 ms, p95 0.95 / 0.75 ms                    | p50 0.67 / 0.51 ms     |
| 100 saves with a 492 KB screenshot           | —                              | 48.1 MB Markdown → 0.7 MB database                        | same                   |

Main-thread stall is the longest gap between 2 ms heartbeats on the process that owns the database client.
