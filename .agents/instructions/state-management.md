# Renderer state ownership

Keep each state value with the smallest owner that can manage its full lifecycle. A hook provides a workflow API; a reducer makes related transitions explicit; context connects a shared owner to its consumers. These are tools for ownership, not targets for moving every value into a store.

| State                                                                                     | Owner                                                                       |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Recording runtime, capture source discovery, recording history                            | `src/state/RecordingSlice.ts` and `HistorySlice.ts`, through workflow hooks |
| Store creation and desktop runtime subscription                                           | `src/components/RendererProvider.tsx` and `src/state/RecordingBridge.ts`    |
| Playback, media loading, click activity, screenshots, document editing, instruction flows | Focused `useCamelCase` hooks in `src/hooks`                                 |
| Settings and model-selection requests and drafts                                          | Local workflow hooks and reducers                                           |
| Open menus, expanded sections, tabs, focus                                                | The component that presents the control                                     |
| Native recording, persisted data, credentials and coordination across windows             | Electron services through the typed preload API                             |

Paths above are relative to `apps/renderer`. See the [architecture map](../architecture.md) for the process and package boundaries.

Store configuration lives in `src/state/RendererStore.ts`; `src/state/DesktopDependencies.ts` defines the desktop effects injected into thunks.

## Shared state

- Create the Redux store inside `RendererProvider`, once per mounted provider. Do not export a module-level store; static rendering and separate windows must not share mutable JavaScript state.
- Use `src/hooks/useRendererDispatch.ts`, `useRendererSelector.ts`, and `useRendererStore.ts` inside workflow hooks. Keep each hook in its own file. Components consume workflow operations and selected values instead of duplicating bridge calls and subscriptions.
- The recording bridge owns its listener and polling timer. Connect only on routes with recording controls, and dispose on navigation or unmount. Electron remains the authority across windows.
- Keep Redux state and actions serializable. Store summaries, runtime snapshots, request identifiers and errors; keep DOM nodes, streams, abort controllers, object URLs, timers and credential drafts with their local lifecycle owner.
- Reducers describe transitions without I/O. Thunks call injected desktop capabilities. Keep dependency injection at the store boundary so tests can exercise ordering without launching Electron.

## Local workflows and asynchronous work

- Extract a hook when it owns a coherent workflow or resource lifecycle. Use a local reducer when loading, editing, pending, success and failure states change together. Leave simple display choices in their component.
- Derive values from existing state. Use refs for resource handles and immediate concurrency guards, not an independent second copy of visible state. A document revision ref may protect asynchronous edits; update it through the same commit operation as the rendered document.
- Scope requests to their recording, session or request ID. Ignore stale completions after a newer request, user edit, recording switch or unmount. A pushed desktop event must take precedence over an older poll or command response.
- Serialize writes to the same resource. After a successful history mutation, refresh from main so a concurrent recording completion remains visible; older refreshes must not restore a deleted recording or its previous title.
- Cancel supported work and release subscriptions, observers, animation frames, timers, readers and object URLs. Invalidating an uncancelable IPC response only prevents a stale UI update; it does not cancel the native operation.
- Keep error and pending states visible and preserve user drafts on failure. A completed save must not clear text entered while it was pending.

Test observable transitions with controlled promises and React lifecycle tests: out-of-order responses, record changes, duplicate actions, failure recovery, and cleanup. Add cases for actual risks introduced by the change; follow [verification](verification.md) for repository and native checks.
