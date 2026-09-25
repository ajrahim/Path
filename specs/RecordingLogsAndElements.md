# Recording Logs and Elements

Status: Active

## Goal

Align externally captured evidence (application logs and tracked UI element paths) with a recording's real-world time so it can be reviewed beside the video and used for document generation.

## User Experience

1. The review section below the video shows a horizontal tab menu, `[Activity] [Logs] [Elements]`, in place of the Activity title. Activity keeps its current behavior.
2. In Logs or Elements, the user imports a file. The desktop reads it, finds each row's timestamp, and aligns it to the video using the recording's real-world start time and pauses.
3. The tab shows the video's real-world start and end, the imported file, and rows with their video time. Rows outside the video are dropped from view and counted.
4. The user can adjust a per-import time offset in seconds, search rows, click a row to seek, and see the row at the playhead highlighted.
5. Aligned logs and elements are included as evidence when generating or updating a document.

## Requirements

- New recordings persist the wall-clock time of media zero and each pause's media offset and duration.
- Row timestamps: ISO 8601/RFC 3339, `YYYY-MM-DD HH:MM:SS[.fff]` (optionally bracketed, `/` date separators, `,` fractions, zone offsets), epoch seconds or milliseconds, and time-only `HH:MM:SS[.fff]` resolved against the recording's local date. Timestamps without a zone use local time.
- JSON Lines rows `{"timestamp": ..., "message": ...}` (logs) or `{"timestamp": ..., "path": ...}` (elements) are accepted.
- Untimestamped lines continue the previous row; lines before the first row are counted as unreadable.
- One import per kind per recording; a new import replaces the previous one. Removing an import deletes its rows only.
- Every parsed row is stored with its original wall-clock time; rows outside the video are excluded when aligned, so an offset change can bring them into view without re-importing.
- Imports are available as soon as capture stops, including while the video is processing; only an active capture lacks the timing needed to align rows. The selected tab and an in-progress import survive the recording becoming ready.
- The maximum import file size defaults to 10 MB and is configurable in Settings from 1 to 100 MB.

## Acceptance Criteria

- [x] Tabs support click, arrow keys, Home, and End; Activity search, filter, retry, editing, and seeking are unchanged.
- [x] Rows map to video time, excluding paused wall time; rows during a pause map to the pause point.
- [x] Rows outside the video window are not shown and are counted; changing the offset re-aligns without re-importing.
- [x] Files over the configured limit are rejected with the limit shown; files without timestamped rows are rejected.
- [x] Logs and elements can be imported while a recording is processing; the tab and the import result persist when processing finishes.
- [x] Document prompts include bounded, chronological log and element evidence.
- [ ] Repository checks, tests, and production build pass.

## Constraints

- The renderer never reads files; the main process opens the file dialog, validates input, and stores rows.
- Imported text is untrusted evidence: bounded per row and treated as data in prompts.
- Large imports remain responsive: files stream through the database worker into a staging import that replaces the previous one in one transaction, the list requests only the pages near its viewport, and search runs in the desktop against every stored row. See [Local persistence](LocalPersistence.md).

## Out of Scope

- The external element-tracking tool and any live streaming or tailing of logs.
- Overlays of log or element rows on the video.
- Editing or deleting individual imported rows; multiple files per tab.

## Source Ownership

`SessionClock` and `RecordingController` capture media timing; `RecordingRepository` and `TimelineImportRepository` persist it and imported rows (`0000_baseline`). `@path/timeline` owns parsing (`TimelineImportParser`) and alignment (`MediaTiming`). `TimelineImportService` owns import validation, paged reads, and prompt evidence; `TimelineImportJob` streams files in the database worker; `useTimelineImportRows` owns the renderer's page cache. `WorkspacePage` owns the review tab and `useTimelineImports` above the status-keyed `RecordingPane`; `TimelineTabs` and `TimelineImportPanel` render them.

## Verification

Verified on 2026-09-23:

- New tests pass: `MediaTiming`, `TimelineImportParser`, `SessionClock`, `TimelineImportService`, `TimelineImportIpc`, `RecordingMediaTiming`, `DocumentPrompt`, `DesktopSettingsService`, `TimelineImportRepository`, `TimelineTabs`, `TimelineImportPanel`, `TimelineImportsHook`, `RecordingPaneUi`, `WorkspaceTimelineImports`, and `ActivityTimeline`.
- Full suite with a Node-built copy of better-sqlite3 12.11.1: 368 passed, 9 failed. The 9 failures predate this change and are in unrelated in-progress files (`OllamaClickActionAnalyzer`, `InstructionFlowSelect`, `RecordingProjectsUi`, `RecordingRenameUi`).
- Typecheck, dependency-cruiser, and Knip pass. ESLint and Prettier report issues only in other uncommitted in-progress files not touched by this change.
- Renderer production build and `node tests/RendererPages.mjs` pass. The desktop bundle compiles with the repository's esbuild settings.
- Built renderer checked with a mocked bridge in light and dark themes at 1480×900 and 1180×720: tabs, virtualized rows (400 rows, about 16 rendered), element breadcrumbs, no horizontal overflow, and the Settings limit field.
- 2026-09-24: paged rows, streaming import, and full-window evidence are covered by the tests and measurements recorded in [Local persistence](LocalPersistence.md). Approximate timing for recordings without stored media timing was removed; such recordings cannot be aligned.

Unverified: the native file dialog and a live import inside the running Electron app.
