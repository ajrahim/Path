# Architectural decisions

Durable design decisions and their underlying rationale:

### 1. Native capabilities stay in Electron Main

The renderer runs sandboxed (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`) and accesses desktop features exclusively through typed preload IPC. Main owns filesystem operations, native hooks, SQLite, and credential storage to guarantee process safety.

### 2. Monotonic session clock for media synchronization

Clicks and video chunks are stamped against a monotonic `SessionClock` origin (`elapsedMs`). Wall-clock timestamps are used strictly for human-facing capture dates. Coordinate conversions retain DIP, display, and video reference units to prevent multi-monitor scaling drift.

### 3. Separation of metadata and media storage

SQLite stores structured metadata, editable transcript segments, and click coordinates. Media files (MP4, WAV, screenshots) reside in managed recording directories on the filesystem to keep database operations lightweight.

### 4. Explicit AI model selection & privacy boundary

Local Ollama and cloud AI models (Anthropic, OpenAI, Google, OpenRouter) are strictly selected by the user, independently for Visual screenshot analysis and Text document generation. Older profiles initialize both roles from the previous single selection. Failures never trigger unprompted fallback to another provider. Cloud requests transmit only bounded text context and processed click screenshots—never raw video or full audio streams. Each local request carries its own model so overlapping visual and text operations cannot change one another's routing.

### 5. Flat renderer structure with strict unidirectional data flow

Renderer TypeScript code is organized into flat directories (`pages`, `components`, `hooks`, `state`, `lib`). Data flows strictly: Pages -> Components/Hooks -> Redux State -> Browser Helpers.

### 6. Static renderer export in production

Production builds compile Next.js to a static export served locally via Electron's custom `path://renderer` protocol, eliminating local Node.js web server overhead.
