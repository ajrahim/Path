# Architecture and ownership

Path is an npm workspace monorepo. Electron owns desktop capabilities; a statically exported Next.js Pages Router application owns browser presentation. The application does not run a Next.js production server.

```text
Application pages -> components/hooks -> state/browser helpers
Browser helpers -> window.desktop preload API -> IPC
IPC -> desktop services/controllers -> package APIs and native adapters
```

The capture worker is a separate sandboxed renderer: browser media APIs produce chunks, and validated IPC transfers them to the desktop recording controller. Native input events and media chunks join the same recording lifecycle in main.

| Owner                                                                     | Responsibility and entry points                                                                        |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `apps/desktop/src/Main.ts`                                                | Application composition, profile setup, startup recovery, dependency wiring, and shutdown              |
| `apps/desktop/src/Preload.ts`, `ipc/`                                     | Typed bridge exposure, incoming validation, restricted sender checks, and desktop dispatch             |
| `apps/desktop/src/recording/`                                             | Recording lifecycle, region selection, click collection, screenshot capture, and analysis coordination |
| `apps/desktop/src/windows/`, `tray/`                                      | Window security/lifecycle, static renderer serving, tray and floating controls                         |
| `apps/desktop/src/media/`                                                 | FFmpeg processing and token-protected loopback media delivery                                          |
| `apps/desktop/src/input/`                                                 | Native global-input adapter behind its owned interface                                                 |
| `apps/desktop/src/storage/`, `settings/`                                  | Managed recording assets, encrypted credentials, and settings orchestration                            |
| `apps/desktop/src/ai/`                                                    | Selected local/cloud model, provider adaptation, click interpretation, and document prompt policy      |
| `apps/renderer/src/pages/`                                                | Direct Next pages, shared providers/styles, the document shell, and the home entry                     |
| `apps/renderer/src/components/`                                           | Page controls, recording/document presentation, screenshot controls, and the renderer provider         |
| `apps/renderer/src/hooks/`                                                | Local workflow/resource hooks, recording/history operations, and typed Redux hooks                     |
| `apps/renderer/src/state/`                                                | Per-provider Redux store, recording/history slices, desktop dependencies, and recording subscription   |
| `apps/renderer/src/lib/`                                                  | Browser bridge access, capture engine, instruction-flow data, formatting, and geometry                 |
| `apps/renderer/src/styles/index.css`                                      | Single stylesheet entry with ordered Tailwind, global, and owner imports                               |
| `apps/renderer/src/styles/global.css`                                     | App-wide tokens, reset rules, and shared defaults                                                      |
| `apps/renderer/src/styles/components/`, `apps/renderer/src/styles/pages/` | Styles grouped by their component or page owner                                                        |
| `apps/renderer/src/Desktop.d.ts`                                          | Browser declaration of the typed preload API                                                           |
| `packages/shared`                                                         | Domain DTOs, IPC channels/schemas, bridge interface, and translation catalog                           |
| `packages/recording-core`                                                 | Pure state transitions, coordinate mapping, and session clock                                          |
| `packages/timeline`                                                       | Pure click/transcript correlation                                                                      |
| `packages/database`                                                       | SQLite connection, Drizzle schema/migrations, and repositories                                         |
| `packages/transcription`                                                  | Transcription contract and whisper.cpp adapter                                                         |

Package `test/` directories and application `test/` directories contain Vitest tests for their owner. Root `tests/` contains browser smoke checks and interactive Electron integration scripts. `scripts/` contains repository tooling, not product behavior. `.agents/` contains engineering context, not prompts automatically sent to an AI provider.

Renderer TypeScript folders stay flat. Authored source, test, fixture, and script basenames use PascalCase across apps and packages, including helpers, state, declarations, and desktop entry sources. Class files match their main exported class; hooks use `useCamelCase` filenames. Preserve test/declaration suffixes and the [engineering contract's filename exceptions](instructions/engineering.md#readability-and-comments). Do not reintroduce feature folders, nested UI folders, or single-component directories. Existing desktop/package domain folders remain unchanged.

Styles are the nested exception: `src/styles/components/Button.css` owns button rules, while `src/styles/pages/RegionPage.css` owns region-page rules. `src/pages/_app.tsx` imports only `src/styles/index.css`, an ordered manifest of Tailwind, `global.css`, then owner stylesheets. `global.css` keeps the app-wide tokens, resets, and shared defaults; this order preserves their cascade priority. Keep static presentation in these files and computed geometry inline where needed. A component or page with no distinct rules does not need an empty stylesheet.

Next uses `apps/renderer/src/pages` directly. Each of the six PascalCase page files exports its component as default, so `RecorderPage.tsx` becomes `/RecorderPage/`. `_app.tsx` owns shared providers/styles and scopes recording subscriptions using the router pathname; `_document.tsx` owns the document shell. The sole alias, `index.tsx`, re-exports `WorkspacePage` to keep `/` as the home URL. Do not create a renderer-root `pages` folder: Next would select it instead of `src/pages`.

The browser-safe `RENDERER_ROUTES` contract in `packages/shared/src/RendererRoutes.ts` supplies URLs to both Electron windows and browser navigation. The six direct routes are `/WorkspacePage/`, `/CapturePage/`, `/RecorderPage/`, `/RecordingToolbarPage/`, `/RegionPage/`, and `/SettingsPage/`. The static export and development server use the same filename-based routes without export maps or rewrites. Match casing in consumers and tests when changing a page name.

Pages compose components and hooks and may use browser helpers. Components may depend on hooks, state, and helpers; hooks may depend on state and helpers; state may depend on helpers. None of those layers may import their consumers. In particular, `lib` does not import pages, components, hooks, or state. Hooks, state, and helpers do not import styles. `.dependency-cruiser.cjs` checks these directions alongside the process and package boundaries.

`components/RendererProvider.tsx` supplies Redux context to pages. Recording runtime and history live in `state/RecordingSlice.ts` and `state/HistorySlice.ts`; `hooks/useRecording.ts` and `hooks/useRecordingHistory.ts` expose operations to consumers. Media, playback, click activity, screenshots, document editing, instruction flows, settings, and model selection use local hooks. Browser resources stay with those hooks, and Electron remains the authority for persisted and cross-window state. See [renderer state ownership](instructions/state-management.md) before changing these boundaries.

To add or change an IPC capability, update `packages/shared/src/Ipc.ts`, preload, its main-process handler, and the owning service together; update the renderer consumer and boundary tests. To change stored data, start with the database repository/schema or managed asset owner and account for existing profiles. To change generated documents, trace the selected instruction flow through `ai/DocumentPrompt.ts` and the selected AI service.

The [engineering contract](instructions/engineering.md) defines dependency restrictions. The [workflow specification](specs/recording-workflow.md) defines behavior to preserve; the [current-state memory](memory-bank/current-state.md) records capability gaps rather than promising future implementations.
