# Document Structure

Status: Shipped

## Goal

Let users generate one combined document or a model-determined set of separate documents from a recording. Support specifications, help guides, feedback, and custom prompts without changing Path's existing design language.

## User Experience

1. The document-type header contains the compact `Combine` / `Split` toggle switch and an icon-only Generate action.
2. `Combine` is the default and produces one document covering the recorded workflows.
3. With `Split` selected, Generate identifies distinct workflows from recorded evidence and generates a complete document for each. The user does not enter a document count.
4. A recording covering distinct Login, Registration, and Forgot Password workflows can produce three titled documents rather than one document with three headings.
5. Generated documents appear as named tabs above the editor, with a Plus control at the right and no count label. Selecting a tab opens that document for editing and existing document actions.
6. Changing Combine/Split configures the next generation; it does not immediately merge, split, discard, or regenerate existing content.

## Requirements

- Use `Combine`, `Split`, and descriptive generated document titles to communicate organization without instructional cards or a manual document-count control.
- Persist the generation mode per recording; recordings without a saved choice default to Combine.
- Apply the mode independently of the selected instruction flow, including Spec Document, Help Guide, Provide Feedback, and custom prompts.
- Let the model determine meaningful document boundaries and count from the available evidence. Split can return one document when only one coherent workflow exists.
- Generate every identified document using the selected flow's instructions. Each document must be complete for its workflow, retaining relevant shared context and supported timestamp references.
- Treat recording content as evidence, not executable instructions. Do not invent workflows, requirements, defects, or unseen steps to increase the document count.
- Validate model output as a structured, ordered collection of nonempty titled Markdown documents before committing it. Reject malformed, duplicate, empty, or incomplete results with a recoverable error.
- Commit a generated collection and its initial document revisions atomically before exposing success; preserve explicit Save semantics for editor content.
- Keep document identity, recovery drafts, concurrency checks, revision history, and saved content independent for each document.
- Preserve the existing unsaved-change guard when switching documents and confirming regeneration of an existing collection.
- Chat updates, copy, save, export, version preview/restore, and eligible CLI deployment act on the active document. Keep the current Help Guide deployment restriction.
- Generation failure leaves the prior collection and drafts intact. Retrying uses the requested mode and current ready instructions.
- Reopening a recording restores its collection and generation mode without mixing documents or recordings.

## Acceptance Criteria

- [x] A recording without a stored mode opens with Combine selected and generates one document using the existing single-document behavior. **PASS:** `DocumentRepository.test.ts`, `GuideDocumentService.test.ts`, and existing `GuideDocumentHooks.test.ts`.
- [x] A deterministic model fixture identifying Login, Registration, and Forgot Password produces three independently accessible documents with the selected prompt's required content. **PASS:** `GuideDocumentService.test.ts` verifies the plan plus one full generation per workflow; `GuidePaneHistory.test.tsx` verifies independent tabs.
- [x] Split accepts a valid single-workflow result containing one document rather than forcing unnecessary documents. **PASS:** `GuideDocumentService.test.ts`, single-workflow fixture.
- [x] Parameterized tests cover Spec Document, Help Guide, Provide Feedback, and custom flows in both modes. **PASS:** eight parameterized cases in `GuideDocumentService.test.ts`.
- [x] Switching the mode without generating leaves all current document content and revisions unchanged. **PASS:** `GuidePaneHistory.test.tsx` and browser mode-switch checks.
- [x] Mode selection and document navigation support keyboard interaction, visible focus, and accessible selected states; generation controls respect loading and busy states. **PASS:** `GuideDocumentStructure.test.tsx`, `GuidePanePromptReadiness.test.tsx`, and browser interaction checks.
- [x] Editing, saving, updating, exporting, and restoring one document cannot overwrite a sibling; unsaved edits follow the existing save/discard guard. **PASS:** `DocumentRepository.test.ts`, scoped-action checks in `GuideDocumentHooks.test.ts`, and save/discard/cancel/export checks in `GuidePaneHistory.test.tsx` and the browser.
- [x] Reopening a recording restores all generated documents, their independent saved history/recovery drafts, and the selected mode. **PASS:** file-backed restart test in `DocumentRepository.test.ts`.
- [x] Invalid output or failure during generation commits no partial collection and preserves prior content; retry remains available. **PASS:** invalid-plan, empty-body, and late-provider-failure cases in `GuideDocumentService.test.ts`; transaction rollback in `DocumentRepository.test.ts`; existing retry/readiness tests.
- [x] Existing single-document persistence, image references, revision history, and default app-link generation remain intact. **PASS:** baseline migration in `Connection.test.ts` and the full suite, including existing document/image/app-link tests.
- [x] Desktop and narrow-pane visual checks in light/dark themes show no overlapping controls, clipped labels, or inaccessible document tabs. **PASS:** Playwright browser fixture at 1440, 960, and 390 viewport widths, section widths down to 304 CSS pixels, containment/overlap checks, and dark/light screenshots.
- [x] Focused generation, persistence, and renderer tests plus `npm run check`, `npm test`, and `npm run build` pass; record actual evidence before changing status to Shipped. **PASS:** 109 test files / 734 tests; formatting, lint, all workspace types, architecture, Knip, renderer export, and desktop bundling.

## Constraints

- Follow `apps/renderer/AGENTS.md` and the engineering contract. Reuse the existing surface, text, border, accent, focus, spacing, and control tokens; avoid nested cards or a new visual theme.
- Keep the section compact and unframed inside the current document pane; use Lucide icons and responsive, accessible controls consistent with existing components.
- Validate IPC and AI boundaries with shared contracts and strict schemas. Keep AI execution and durable storage in desktop/database owners, not renderer components.
- Add a versioned database migration for multiple document identities; preserve existing documents and append-only history rather than rewriting applied migrations.

## Technical Notes

- `GuidePane.tsx` currently chooses instructions and calls `useGuideDocument`; introduce a narrowly owned section component and connect mode/document selection through this existing path.
- `GuideDocumentService.generate` and `DocumentPrompt.ts` currently produce one Markdown result; preserve Combine and add validated collection generation for Split.
- `DocumentRepository.ts` currently addresses one document by recording ID. Extend the existing repository, worker, shared IPC contracts, and document state together for document-scoped operations.
- Extend nearby service, repository, and pane tests; use deterministic model fixtures to verify grouping and failure safety without live-provider dependencies.
- Split validates a plan of 1-24 uniquely titled workflows, then generates each complete document sequentially through the existing AI service. This preserves the existing per-document token budget and provider scheduling. No collection is committed until every document succeeds.
- AI and UI verification used deterministic fixtures, not live provider calls. Model judgment about workflow boundaries remains dependent on the selected model and recorded evidence.

## Implementation Scope

- Desktop: `Preload.ts`, `ai/DocumentPrompt.ts`, `documents/GuideDocumentService.ts`, `ipc/RegisterIpc.ts`, and `test/GuideDocumentService.test.ts`.
- Renderer: `components/GuidePane.tsx`, `GuideDocumentStructure.tsx`, `GuideDiscardDialog.tsx`; `hooks/useGuideDocument.ts`, `useGuideCollection.ts`; `pages/WorkspacePage.tsx`; `styles/index.css`, `styles/components/GuideDocumentStructure.css`.
- Renderer tests: `GuideDocumentHooks.test.ts`, `GuideDocumentStoreFixture.ts`, `GuideDocumentStructure.test.tsx`, `GuidePaneHistory.test.tsx`, `GuidePanePromptReadiness.test.tsx`.
- Database: `src/DocumentRepository.ts`, `src/Schema.ts`, `drizzle/0001_DocumentStructure.sql`, generated migration journal/snapshot, and `test/Connection.test.ts`, `test/DocumentRepository.test.ts`.
- Shared: `src/Contracts.ts`, `src/Ipc.ts`, `messages/en.json`. Documentation: this spec, repository `README.md`, `.agents/README.md`, and `.agents/instructions/StateManagement.md`.

## Out of Scope

- Manual document-count selection, nested folders, and cross-recording grouping. Current tab actions are described in [Document Tab Actions](DocumentTabActions.md).
- Automatically merging or splitting existing documents when the mode changes.
- Batch CLI deployment, bulk export, new app-link parameters, new providers, or unrelated prompt/settings redesigns.
