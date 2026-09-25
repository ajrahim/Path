# Architectural decisions

Durable design decisions and their underlying rationale:

### 1. Native capabilities stay in Electron Main

The renderer runs sandboxed (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`) and accesses desktop features exclusively through typed preload IPC. Main owns filesystem operations, native hooks, SQLite, and credential storage to guarantee process safety.

### 2. Monotonic session clock for media synchronization

Clicks and video chunks are stamped against a monotonic `SessionClock` origin (`elapsedMs`). Wall-clock timestamps are used strictly for human-facing capture dates. Coordinate conversions retain DIP, display, and video reference units to prevent multi-monitor scaling drift.

### 3. Separation of metadata and media storage

SQLite stores structured metadata, editable transcript segments, click coordinates, imported rows, and document history. Media files (MP4, WAV, screenshots) reside in managed recording directories on the filesystem to keep database operations lightweight. Each recording references the storage root it was captured in. File deletions are queued in the same transaction as their rows, so a locked file is retried instead of orphaned.

### 4. Explicit AI model selection & privacy boundary

Local Ollama and cloud AI models (Anthropic, OpenAI, Google, OpenRouter) are strictly selected by the user, independently for Visual screenshot analysis and Text document generation. Failures never trigger unprompted fallback to another provider. Cloud requests transmit only bounded text context and processed click screenshots—never raw video or full audio streams. Each local request carries its own model so overlapping visual and text operations cannot change one another's routing.

### 5. Flat renderer structure with strict unidirectional data flow

Renderer TypeScript code is organized into flat directories (`pages`, `components`, `hooks`, `state`, `lib`). Data flows strictly: Pages -> Components/Hooks -> Redux State -> Browser Helpers.

### 6. Static renderer export in production

Production builds compile Next.js to a static export served locally via Electron's custom `path://renderer` protocol, eliminating local Node.js web server overhead.

### 7. SQLite runs in a desktop worker thread

better-sqlite3 is synchronous, and imports of up to 100 MB blocked the Electron main thread for seconds. One `worker_threads` worker owns the connection. Requests run one at a time in arrival order, and each repository method is one transaction. Imports stream in batches. The worker exits on its own at quit: forcing termination while the native module is active crashed a host process in testing, so `terminate()` is only a deadline fallback.

### 8. Pre-release migrations were squashed into one baseline

Path had no user data to migrate, so migrations 0000–0003 were replaced by `0000_baseline`. From this baseline on, schema changes add migrations. A database with unknown migration history is refused rather than reset, and `npm run db:reset` moves it aside.

### 9. Documents keep append-only snapshot revisions and a separate recovery draft

Revisions are whole snapshots, because restore and compare need exact text and documents are small. Embedded screenshots are the exception: data URLs are stored once per document, since each save would otherwise repeat them. A draft is not a revision, and saving stays explicit. Stale writes are detected with the saved revision and draft version, never by timestamps.
