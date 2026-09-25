# Architecture and ownership

Path is an npm workspace monorepo. Electron owns desktop capabilities and native orchestration; a statically exported Next.js Pages Router application owns browser UI. The app runs no production Node.js server.

```text
Application Pages -> Components / Hooks -> State / Browser Helpers
Browser Helpers -> window.desktop (Preload API) -> IPC
IPC Handlers -> Desktop Services / Controllers -> Domain Packages & Native Adapters
```

## Workspace and package ownership

| Package / Directory        | Type           | Responsibility & Entry Points                                                                                                                                                                                                                                                                          |
| -------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/desktop/`            | Electron Main  | App lifecycle ([Main.ts](../../apps/desktop/src/Main.ts)), typed bridge ([Preload.ts](../../apps/desktop/src/Preload.ts)), IPC validation ([RegisterIpc.ts](../../apps/desktop/src/ipc/RegisterIpc.ts)), recording orchestration, loopback media server, safeStorage credentials, and native adapters. |
| `apps/renderer/`           | Next.js Pages  | Flat UI architecture: direct Pages (`src/pages`), presentation (`src/components`), workflow hooks (`src/hooks`), Redux Toolkit state (`src/state`), browser helpers (`src/lib`), and owner stylesheets (`src/styles`).                                                                                 |
| `packages/shared/`         | Pure Contracts | Serializable DTOs, Zod IPC validation schemas, route constants (`RendererRoutes.ts`), and localized translation catalogs (`messages/en.json`).                                                                                                                                                         |
| `packages/recording-core/` | Pure Domain    | Deterministic state machine transitions, monotonic session clock, and DIP-to-video coordinate mapping (zero I/O).                                                                                                                                                                                      |
| `packages/timeline/`       | Pure Domain    | Chronological correlation of transcript segments and click events for seekable playback (zero I/O).                                                                                                                                                                                                    |
| `packages/database/`       | Infrastructure | SQLite connection, Drizzle schema & `0000_baseline` migration, and synchronous typed repositories (recordings, documents, imports, projects, settings, storage roots, asset deletions). They run only inside the desktop database worker.                                                              |
| `packages/transcription/`  | Infrastructure | Audio transcription contract and whisper.cpp Windows x64 runtime adapter with SHA-256 model verification.                                                                                                                                                                                              |

## Renderer structure and routing

- **Flat TypeScript Directories:** `src/pages`, `src/components`, `src/hooks`, `src/state`, and `src/lib`. No nested feature or single-component folders.
- **Pages Router:** `src/pages` PascalCase filenames define direct routes: `/WorkspacePage/` (aliased to `/` via `index.tsx`), `/CapturePage/`, `/RecorderPage/`, `/RecordingToolbarPage/`, `/RegionPage/`, and `/SettingsPage/`.
- **Route Contract:** Electron windows and renderer navigation stay synchronized through `RENDERER_ROUTES` in `@path/shared`.
- **Styles Hierarchy:** `src/pages/_app.tsx` imports single entry `src/styles/index.css` (Tailwind -> `global.css` defaults -> `styles/components/<Component>.css` -> `styles/pages/<Page>.css`).

## Layered dependency directions

Strict import hierarchy checked by `.dependency-cruiser.cjs`:

```text
Pages → Components / Hooks → State → Browser Helpers (lib)
Packages (database, transcription, recording-core, timeline, shared) → Pure or Native
Applications (desktop, renderer) → Packages
```

- `lib` never imports pages, components, hooks, or state.
- Hooks never import presentation (pages/components) or styles.
- State never imports presentation or hooks.
- Packages never import applications.

## Local storage

All SQL runs in one desktop worker thread (`apps/desktop/src/storage/DatabaseWorker.ts`), which owns the only SQLite connection. Main-process services call typed repository stand-ins from `DatabaseClient`. Each call crosses the thread boundary and returns a promise; inside the worker, repository methods are synchronous and run one at a time. Media stays in managed directories named `<storage root>/<recording id>/`. Files are deleted through `asset_deletions` intents written with the row deletion. See [Local persistence](../../specs/LocalPersistence.md) for ownership, initialization, recovery, and document history.

To add a repository method, add it to the repository class; the worker and `RemoteRepositories` pick it up by name. Keep each method one transaction, and do not await inside a transaction. A long-running job, such as `TimelineImportJob`, must commit in batches.

## IPC and contract extension workflow

To add or update an IPC capability:

1. Define typed DTOs and Zod schema in `packages/shared/src/Contracts.ts` and `Ipc.ts`.
2. Expose typed method on `DesktopApi` interface in `packages/shared/src/Ipc.ts` and `Desktop.d.ts`.
3. Implement handler in `apps/desktop/src/ipc/RegisterIpc.ts` with schema validation before dispatching to owning desktop service.
4. Wire preload invoker in `apps/desktop/src/Preload.ts`.
5. Consume via `getDesktopApi()` in renderer hooks or thunks with unit test coverage.
