# Recording Projects

The sidebar uses compact recording rows and a New menu with Recording and Project choices. The Projects section comes first, with a Create Project shortcut when empty. All follows and always includes every recording, including Project members. Projects are one level of collapsible folders. Drag a recording into a Project or use its Move to Project menu; choose Ungrouped in that menu to remove membership. Search finds recording titles across collapsed folders and shows a Project's contents when its name matches. Date, duration, and processing state remain available through recording tooltips and accessible labels.

Projects can be renamed and removed. Removing a Project deletes membership only, keeping its recordings in All. Recording deletion cascades its membership; no project operation edits media, transcripts, or documents.

## Ownership

- `packages/database/src/ProjectRepository.ts` owns transactional membership updates. The additive `0002_brave_shockwave.sql` migration creates projects and their membership table; each recording has at most one Project.
- `packages/shared/src/Ipc.ts` validates project mutations and exposes the typed projects bridge. Main-process handlers and preload use the same contract.
- `ProjectSlice.ts` owns renderer snapshots and protects successful writes from stale reads. `useRecordingProjects.ts` refreshes on mount and window focus.
- `HistorySidebar.tsx`, `HistoryMenu.tsx`, and `ProjectDialog.tsx` own presentation, drag and drop, keyboard menus, and naming/move dialogs. Folder expansion is local to the current window.

## Verification

`ProjectRepository.test.ts` checks upgrades of an existing library, reopened persistence, moves, ungrouping, foreign-key cleanup, invalid destinations, and document preservation. `RecordingProjectsUi.test.tsx` covers creation, drag/drop, collapsed-folder search, removal, and retrying a failed menu-driven move. `ProjectState.test.ts` checks concurrent writes and stale reads. Existing sidebar and recording rename tests cover the shared menu.

A running desktop process must reload its preload/main bundle before the new projects bridge is available. Browser preview uses synthetic in-memory data; database tests verify durable storage independently.
