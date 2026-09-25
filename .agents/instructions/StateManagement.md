# Renderer state ownership

Keep each state value with the smallest owner that can manage its full lifecycle. Hooks provide workflow APIs, reducers make complex transitions explicit, and Redux Toolkit provides cross-window/cross-component synchronization.

## State ownership matrix

| State Domain                          | Owner                | Implementation Path                                                                                                        |
| ------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Recording runtime & history           | Redux Toolkit Slices | `src/state/RecordingSlice.ts`, `src/state/HistorySlice.ts`                                                                 |
| Store creation & runtime subscription | Provider & Bridge    | `src/components/RendererProvider.tsx`, `src/state/RecordingBridge.ts`                                                      |
| Active playback & seek position       | Local Workflow Hook  | `src/hooks/useRecordingPlayback.ts`                                                                                        |
| Media loading & blob streaming        | Local Workflow Hook  | `src/hooks/useRecordingMedia.ts`                                                                                           |
| Click activity & screenshot URLs      | Local Workflow Hooks | `src/hooks/useRecordingActivity.ts`, `src/hooks/useScreenshotUrl.ts`                                                       |
| Imported logs & element paths         | Page Workflow Hook   | `src/hooks/useTimelineImports.ts` (summaries, called by `WorkspacePage`); `src/hooks/useTimelineImportRows.ts` (row pages) |
| Markdown editor, drafts & history     | Local Workflow Hook  | `src/hooks/useGuideDocument.ts`; durable document, draft, and revisions in `GuideDocumentService` (desktop)                |
| Prompt library & saved selection      | Electron Service     | `apps/desktop/src/settings/InstructionFlowService.ts`; renderer snapshots and drafts in `src/hooks/useInstructionFlows.ts` |
| Settings & AI model discovery         | Local Workflow Hooks | `src/hooks/useSettingsEditor.ts`, `src/hooks/useAiModels.ts`                                                               |
| UI controls (menus, popovers, focus)  | Component State      | Local React component state (`useState`)                                                                                   |
| Native capture, database, credentials | Electron Services    | Accessed exclusively through typed preload bridge `window.desktop`                                                         |

## Shared state rules (Redux)

- **One Store per Provider Instance:** Instantiate the Redux store inside `RendererProvider`. Never export a module-level store singleton.
- **Typed Hooks:** Components and hooks use `useRendererDispatch`, `useRendererSelector`, and `useRendererStore` from `src/hooks/`.
- **Serializable State Only:** Store summaries, runtime snapshots, and errors. Keep DOM nodes, media streams, AbortControllers, and timer IDs in local hooks.
- **Dependency Injection:** Thunks receive typed desktop capabilities via `DesktopDependencies.ts` for clean testability.

## Local workflow and concurrency rules

- **Request Scoping:** Scope async operations to the active `recordingId` or session token. Discard out-of-order completions when switching recordings or unmounting.
- **Resource Disposal:** Clean up subscriptions, MediaStream tracks, event listeners, animation frames, and revocable object URLs on unmount.
- **Draft Safety:** Preserve uncommitted user input (e.g. Markdown drafts, renamed recording titles) during transient errors or background refreshes.
- **Documents:** The desktop owns saved documents, recovery drafts, and revisions. `useGuideDocument` debounces draft writes (never per keystroke), flushes them before AI results, restores, recording switches, and quit, and sends the saved revision and draft version it last saw. It applies an AI result only when the text did not change during the request. A recovery draft never counts as saved.
- **Large Lists:** Hooks request bounded pages from the desktop for data that can grow large, such as imported rows, and keep a bounded page cache. Never load a whole import or table into a renderer.
- **Prompt Library:** `InstructionFlowService` owns durable prompts, serialized writes, and committed cross-window snapshots. `useInstructionFlows` keeps editor drafts local and applies snapshots by revision. Same-prompt stale edits must be rejected without discarding drafts; selection or unrelated prompt changes must not invalidate them. See [Settings and prompts](../../specs/SettingsAndPrompts.md) for scope and verification.
