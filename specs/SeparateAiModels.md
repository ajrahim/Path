# Separate Visual and Text Models

Status: Shipped

## Goal

Choose the Visual model for screenshot analysis independently from the Text model for document generation, within the existing compact AI models menu.

## Scope

- One header trigger shows the selected Visual and Text model names at 11px with an eye icon for Visual and a document icon for Text, separated by a vertical line within a 230px cap. Long names truncate with ellipses; the tooltip and accessible description retain both full names. It opens the existing searchable model menu, where Visual and Text tabs filter choices to the active role.
- Visual requires image understanding and text output. Text includes supported text-generation models, including text-only Ollama and API models.
- Each role persists independently through the typed, validated desktop bridge. An invalid or failed save preserves the previous selection.
- Older settings initialize both roles from the previous explicit selection, preserving local/cloud choices. A later update changes only its target role.
- Screenshot analysis and document generation use their own selection, including overlapping local requests. Failures never select a different provider.
- Preserve theme tokens, compact rows, borderless utility buttons, search, provider grouping, key setup, and keyboard focus behavior.
- Show `OpenRouter (No Key)` inline in the provider heading when its key is missing. Show Ollama status beside `Local` in the section heading. Selecting a keyless API model still opens key setup.

## Acceptance Criteria

- [x] Changing Text preserves Visual and vice versa, including after a restart.
- [x] Text-only models appear under Text and cannot be saved for Visual through IPC.
- [x] Older settings migrate without replacing valid stored choices.
- [x] Failed saves and stale catalog responses retain the current choices.
- [x] Overlapping visual and text requests use their intended models.
- [x] Tabs support keyboard navigation; search, Escape, and focus return remain usable.
- [x] Light/dark themes and compact desktop widths remain usable.
- [x] Repository checks, tests, and production build pass.

## Out of Scope

Image creation, audio/transcription model selection, model downloads, automatic provider fallback, new providers, and billing dashboards.

## Source Ownership

`LocalModelSelect`, `useAiModels`, and `ModelCatalog` own the UI and workflow. Shared contracts and IPC validate role-specific updates. `DesktopSettingsService` owns migration and persistence. `SelectedAiService`, `OllamaClickActionAnalyzer`, and `ProviderModels` own routing and compatible model discovery.

## Verification

Verified on 2026-09-23:

- Full Vitest suite: 51 files, 280 tests passed. The running Electron app held the repository's Electron-specific SQLite binary, so the suite used an isolated copy of the same SQLite package version built for Node. Application dependencies and the running app were left intact.
- `npm run check`, `npm run build`, `node tests/RendererPages.mjs`, and `git diff --check` passed.
- Built renderer checked in light and dark themes with a mocked desktop bridge: independent selections, text-only filtering, save/reload, tab arrow navigation, Escape focus return, and menu geometry at 1480, 1280, and 1180 pixels wide. The last width and 720-pixel test height match the native window minimum.
- Compact header refinement verified at those same dimensions: computed 11px text, 230px maximum trigger width, divider, actual long-name overflow with ellipsis and full-name tooltip, inline key status, and aligned Local/Ollama heading. Existing component tests and the full 280-test suite pass after the refinement.
- Settings reload/migration and concurrent requests are covered by `DesktopSettingsService.test.ts`, `AiModelSelectionIpc.test.ts`, `SelectedAiService.test.ts`, and `OllamaClickActionAnalyzer.test.ts`. Catalog and UI checks are covered by `ProviderModels.test.ts`, `AiModels.test.ts`, `LocalModelSelect.test.tsx`, and `AiContracts.test.ts`.

Provider requests were mocked; live model inference remains unverified. Direct-provider capabilities use conservative family filters where catalogs omit modality metadata. OpenRouter and Ollama discovery use published capability fields.
