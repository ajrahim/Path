# Settings and Prompts

Status: Shipped

## Goal

Give each Settings section its own sidebar-controlled view, expose Light and Dark appearance choices, and manage the prompt library from Settings while keeping workspace selection and saved prompts synchronized.

## Scope and behavior

- General, Storage, API Keys, and Prompts each render one section at a time inside the existing Settings window. Navigation keeps the `/SettingsPage/` route and the `#general`, `#storage`, `#keys`, and `#prompts` deep links, including native open-settings shortcuts and browser history.
- General includes Light and Dark choices using the existing `next-themes` provider and `path.theme` preference. Theme changes apply to other open renderer windows through their shared origin. The Settings caption overlay follows its theme; the workspace caption keeps its existing brand color.
- Prompts lists default and custom prompts as compact icon, name, and Edit rows. The editor's icon dropdown sits inside the right edge of the prompt-name field. Default identities and names remain fixed; their instructions and icons can be edited, and defaults cannot be deleted.
- Custom prompts can be created, renamed, edited, and deleted. The chosen icon appears in the workspace dropdown. Creating a prompt in Settings preserves the workspace selection; creating one from the workspace selects it.
- The desktop owns durable prompt storage and broadcasts committed snapshots. Prompts left in renderer storage by pre-release builds are not read ([Local persistence](LocalPersistence.md)).
- Writes are serialized against the latest committed library. A stale draft for a prompt changed in another window must be rejected without discarding the user's draft. Unrelated prompt or selection changes must not prevent a valid save.

## Acceptance criteria

- [x] Sidebar navigation shows only the selected section; hash deep links, native shortcuts, Back/Forward, and invalid-hash fallback work without changing the shared Settings window route.
- [x] Existing General, Storage, and API Keys controls retain their behavior and in-progress API-key drafts across section navigation.
- [x] Light and Dark choices persist and synchronize between Settings and workspace; keyboard navigation, focus indicators, and both themes remain usable.
- [x] Default prompts remain available after editing text or icons and cannot be renamed or deleted through either the UI or desktop boundary.
- [x] Custom prompt creation, editing, renaming, deletion, selected-prompt fallback, and dropdown icons persist after restart.
- [x] Concurrent changes to different prompts preserve both results. A stale edit of the same prompt is rejected with its draft intact.
- [x] Failed persistence does not replace the committed library or publish a successful update; retries remain possible. Failed loading does not silently enable a default prompt in place of an unavailable saved selection.
- [x] Repository checks, focused tests, route verification, and the production build have recorded results; remaining native or environment limitations are stated explicitly.

## Compatibility and boundaries

Keep existing built-in IDs, names, and default instruction text. Prompt input is validated at the desktop boundary, with names limited to 80 characters, instructions to 10,000 characters, and icons selected from the shared allowlist. Provider credentials remain under the existing encrypted desktop owner.

The desktop stores the library as a validated `app_settings` row. Renderer-only preview can show the interface without a desktop bridge but cannot write the durable library. Built-in edits change future prompt use and do not rewrite existing generated documents.

## Out of scope

- Provider/model changes, new generation behavior, or changes to existing recordings and generated documents.
- Prompt sharing, cloud synchronization, import/export, version history, or a reset-to-default workflow.
- System/automatic theme mode, a new theme persistence service, or a global visual redesign.
- New top-level Next.js routes or separate native windows for individual Settings sections.

## Source ownership

- [`SettingsPage`](../apps/renderer/src/pages/SettingsPage.tsx) and [`useSettingsNavigation`](../apps/renderer/src/hooks/useSettingsNavigation.ts) own section views and hash navigation. [`useSettingsEditor`](../apps/renderer/src/hooks/useSettingsEditor.ts) retains existing settings drafts and operations.
- [`_app`](../apps/renderer/src/pages/_app.tsx), [`SettingsPage`](../apps/renderer/src/pages/SettingsPage.tsx), [`RendererProtocol`](../apps/desktop/src/windows/RendererProtocol.ts), and [`SettingsWindow`](../apps/desktop/src/windows/SettingsWindow.ts) own existing theme persistence, shared renderer origin, and native Settings captions.
- [`InstructionFlows`](../packages/shared/src/InstructionFlows.ts) owns default prompts, icon IDs, validation, and snapshot contracts. [`InstructionFlowService`](../apps/desktop/src/settings/InstructionFlowService.ts) owns durable, serialized mutations through [`RegisterIpc`](../apps/desktop/src/ipc/RegisterIpc.ts) and [`Preload`](../apps/desktop/src/Preload.ts).
- [`useInstructionFlows`](../apps/renderer/src/hooks/useInstructionFlows.ts) owns snapshots and local editor drafts. [`InstructionFlowEditor`](../apps/renderer/src/components/InstructionFlowEditor.tsx), [`InstructionFlowGlyph`](../apps/renderer/src/components/InstructionFlowGlyph.tsx), and [`InstructionFlowSelect`](../apps/renderer/src/components/InstructionFlowSelect.tsx) render editing controls and icons.

## Verification results — 2026-09-23

- Prompt UI refinement: 25 focused Settings, dropdown, and hook tests pass, along with the production build, scoped lint/formatting, and unused-code check. Browser inspection confirmed compact rows and the embedded icon dropdown in Light/Dark, including the 760 × 620 Settings minimum; keyboard tests cover navigation, selection, and Escape closing the menu without dismissing the editor.

- 82 focused tests across 12 files pass: shared contracts, desktop service/IPC, native Settings-window routing, renderer protocol, prompt hooks/select/editor, Settings controls/navigation, workspace shortcuts, and generation readiness. Deferred legacy migration and pending selection cannot trigger generation with fallback or previous instructions. The prompt modal retains keyboard focus while saving.
- Production renderer/desktop build, all-workspace typechecks, architecture boundaries, unused-code checks, scoped formatting, and whitespace checks pass. Exported-page verification passes all direct pages, hydration, theme, assets, Settings navigation, and browser history.
- Browser visual checks of actual Settings components passed Light/Dark at 940 × 780 and 520 × 780, including default editing, custom creation, icons, reload persistence through the preview fixture, and no horizontal overflow. Dropdown rendering tests verify saved default/custom icons.
- Isolated Electron 42.9.3 with the production `path://renderer` protocol confirmed shared theme storage and storage events in both directions, plus reload persistence.
- Isolated Electron with the actual SQLite connection, migrations, settings repository, and prompt service confirmed custom/default text and icons, selection, revisions, and migration tombstones survive closing and reopening the database. It also rejected default deletion/renaming and stale prompt writes. Service/IPC and multiple-hook tests cover committed broadcasts and open-window updates; a complete packaged UI session was not exercised.
- Full `npm run check` remains blocked by pre-existing formatting in Ollama, SelectedAiService, GuideChatInput, HistorySidebar, and related tests. Full lint reports four pre-existing blank-line errors in SelectedAiService and HistorySidebar files; feature-owned files pass.
- `npm test` cannot rebuild the in-use SQLite binary (`EBUSY`/`EPERM`). The broader run excluding database/integration tests reported 400 passing tests and six existing failures: one Ollama consumed-response assertion, two RecordingProjectsUi sidebar assertions, and three RecordingRenameUi sidebar assertions. The running user app was left open.
