# Decisions

Accepted architectural decisions as of 2026-09-14. Update an entry when its implementation or rationale changes; a new idea belongs in a proposed specification until approved and implemented.

## Native ownership stays in Electron

The renderer is sandboxed and receives explicit capabilities through preload. Main owns capture lifecycle, filesystem access, SQLite, native input, and credentials. This keeps untrusted browser content away from native APIs and gives each side a testable boundary. Shared contracts describe the bridge without importing Electron.

## Shared renderer state has one owner per window

Recording controls and history consumers share Redux Toolkit slices through the renderer provider. This replaces manual subscriber sets and gives asynchronous operations explicit request ordering. Each provider creates its own store; Electron coordinates state across windows, and static rendering must not reuse mutable state between renders. Document editing, activity, media, settings and model selection remain in local hooks because their drafts and resource lifecycles belong to one workflow. The [state ownership guide](../instructions/state-management.md) defines the boundary and cleanup rules; implementation starts at [the renderer provider](../../apps/renderer/src/components/RendererProvider.tsx).

## Flat renderer folders with explicit import direction

Application pages, components, hooks, state, and browser helpers each have one flat folder under `src`. PascalCase component/page files and `useCamelCase` hook files make their role visible without single-component or feature directories. Next Pages Router uses the PascalCase pages in `src/pages` directly, alongside `_app.tsx` and `_document.tsx`. The sole `index.tsx` alias exposes `WorkspacePage` at `/`. Auxiliary URLs match page names, such as `/RecorderPage/`; the shared `RendererRoutes.ts` contract keeps Electron and browser navigation aligned. There is no second pages folder or custom route mapping. The [architecture map](../architecture.md) and dependency rules keep state and helpers independent of their consumers.

Authored source, test, fixture, and script basenames use PascalCase across apps and packages; class files match their main exported class. Hooks keep `useCamelCase` names, and the engineering contract preserves framework/config names, public package entries, data, generated files, and test/declaration suffixes. Filenames do not change function casing, public APIs, persisted identifiers, or the desktop output bundle names.

Styles follow their owners under `src/styles/components` and `src/styles/pages`. A small `src/styles/index.css` manifest imports Tailwind, `global.css` shared tokens/reset/defaults, then owner stylesheets. Separating the ordered imports from global rules preserves the defaults' priority in the cascade. This nested CSS structure keeps presentation easy to find while TypeScript folders remain flat. Static rules stay in CSS; runtime geometry can remain inline.

## Media offsets use a monotonic session clock

Clicks and browser media share a session origin; transcript segments use media-relative timestamps. Wall-clock timestamps provide capture dates only. Coordinate transformations retain their units and reference space so negative monitor origins and display scaling do not become silent timing or hotspot errors. Owners: [recording core](../../packages/recording-core/src) and [click capture](../../apps/desktop/src/recording/ClickCaptureCoordinator.ts).

## Metadata and media have separate owners

SQLite stores metadata and edited transcript/click records. Managed directories store videos, audio, and screenshots. A new recording root affects future recordings; earlier roots remain registered for existing assets. Deleting or relocating content must respect those references and the existing-data boundary. Owners: [database](../../packages/database/src) and [managed assets](../../apps/desktop/src/storage/ManagedRecordingAssets.ts).

## AI selection is explicit

The user's selected local or cloud model serves click analysis and document generation. Missing or failing AI must not silently route content to a different provider. Cloud requests disclose only the context required by the active operation. Generated documents must separate supported evidence from assumptions. Owners: [AI service](../../apps/desktop/src/ai/SelectedAiService.ts) and [document prompt](../../apps/desktop/src/ai/DocumentPrompt.ts).

## Static renderer; separate native checks

Production serves a Next static export inside Electron. Unit tests, a successful build, and configured platform targets do not establish native capture support. Real capture, microphone, input-hook, and permission behavior require an interactive platform-specific check. See [verification](../instructions/verification.md).
