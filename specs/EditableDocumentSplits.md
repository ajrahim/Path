# Editable Document Splits

Status: Shipped

## Goal

Generate the necessary tabs and complete documents from recording content. Combine produces one full-recording document. Split determines meaningful workflow boundaries, names, scopes, and document count from the available evidence and selected instruction flow; existing tab labels do not constrain generation.

## User Experience

1. The header contains the document flow selector, Combine/Split switch, and Generate action. Combine remains the default.
2. Split can restore existing tabs or show initial suggestions. Users can add, rename, remove, and reorder the displayed tabs through the existing controls; these edits organize the current collection rather than prescribing the next generated document set.
3. Generate in Split mode analyzes the recording again, chooses the necessary workflows, and generates a complete document for each using the selected spec, help, feedback, or custom instructions. Users do not need to create tabs or enter a count first.
4. Existing placeholder tabs such as test, new, and testt must not force three documents or become the subjects of the generated specifications. A recording covering Login and Registration can replace them with two correctly titled tabs and distinct, complete specifications.
5. The current tabs and editor stay visible while generation runs. The new tabs and documents appear together only after the entire collection succeeds.
6. Generating over an existing collection uses the overwrite confirmation, which explains that Split will determine fresh tabs from the recording. Prior saved documents, histories, and recovery drafts are retained; replacing membership never deletes them.
7. An empty edited tab list remains empty on reopening, but Generate stays available to discover workflows from the recording. Planning or generation failure retains the prior collection and allows retry.

## Requirements

- Generate must send recording identity, selected document instructions, mode, and any replaced editor text/document identity. It must not accept existing workflow labels, scopes, or a tab-count target as generation input.
- Reuse the existing content planner and selected text-model route. Plan from one recording-evidence snapshot containing speech, described clicks, and sampled imported logs/elements. Treat recording content as evidence, not executable instructions.
- Validate a strict plan of 1-24 uniquely titled workflows. Keep one coherent workflow together; do not split every click, duplicate documents, or invent unsupported workflows. A single document is valid.
- Generate each planned document independently with the full selected instructions and its evidence-derived scope. Require complete, nonempty Markdown; retain relevant shared context, timestamps, assumptions, and open questions.
- Persist the generated workflow plan, collection membership, mode, drafts, and revisions in one database transaction after all model outputs succeed. Do not publish a replacement plan or partially generated documents earlier.
- Check the plan version captured before planning. If another window edits the plan during generation, reject the completed generation without overwriting that newer plan or the previous documents.
- Reuse the identities of matching, previously planned workflows so normal regeneration retains their independent histories. New evidence-derived workflows receive new identities. Keep old document data when workflows leave the visible collection.
- Preserve explicit saves, overwrite/save/discard guards, per-document history and exports, scoped drafts, disabled busy states, and stale-recording completion guards.
- Preserve tab editing and reordering through the existing versioned plan API. Initial suggestions and manual tab edits do not generate revisions; an ungenerated tab never displays a sibling document.
- Keep Combine as one full-recording analysis. Changing mode configures future generation and retains editor content; app-link generation and provider setup stay unchanged.

## Acceptance Criteria

- [x] Placeholder tabs are replaced by the content-selected document set; planning prompts contain recording evidence and selected instructions rather than the old tab names/scopes.
- [x] Spec, help, feedback, and custom flows work in both modes; Split can choose one or several workflows and produce distinct complete bodies.
- [x] Generate remains enabled with an empty plan and adopts the generated tabs and first document.
- [x] Invalid/duplicate/empty/oversized plans, provider failures, and empty/later-failing document bodies leave prior tabs, plan version, and documents intact.
- [x] Atomic database rollback and concurrent-plan rejection preserve the prior document set and newer user edits.
- [x] Normal regeneration retains matching workflow identity and prior revisions; tab editing, dirty-document guards, saves, and history behavior remain covered.
- [x] Repository quality checks, the full test suite, production build, and exported-page checks pass with current evidence.

## Verification Evidence

- 105 focused service, prompt, repository, contract, pane, and hook tests pass. They cover test/new/testt being replaced by Login/Registration, empty-plan discovery, all instruction flows, single-workflow identity/history, invalid plans, partial-generation failure, concurrent edits, and transaction rollback.
- A browser fixture using the real GuidePane, document hooks, validated desktop service, and SQLite passes: Generate replaces three placeholder tabs with two content-derived specifications; each tab loads its own complete requirements and acceptance criteria; a late model failure keeps the existing collection; retry and generation from an empty plan succeed.
- Model responses and recording evidence are deterministic fixtures. Live-provider grouping judgment was not evaluated.
- Final gates pass: repository formatting/lint/types/architecture/Knip, all 110 Vitest files / 769 tests under the matching Electron Node runtime, production renderer/desktop build, and exported-page hydration/navigation checks.

## Ownership

- [GuidePane](../apps/renderer/src/components/GuidePane.tsx) and [useGuideDocument](../apps/renderer/src/hooks/useGuideDocument.ts) initiate generation without a tab plan and adopt the committed collection. [useGuideCollection](../apps/renderer/src/hooks/useGuideCollection.ts) owns displayed tabs, edits, suggestions, and selection.
- [GuideDocumentService](../apps/desktop/src/documents/GuideDocumentService.ts) plans and generates; [DocumentPrompt](../apps/desktop/src/ai/DocumentPrompt.ts) defines evidence-grounded planning and complete per-workflow document prompts.
- [DocumentRepository](../packages/database/src/DocumentRepository.ts) commits plan and documents atomically. The existing workflow-plan/version columns are sufficient; no new migration or provider is required.
- [Shared IPC contracts](../packages/shared/src/Ipc.ts) validate generation and editable-plan requests separately. Renderer code remains browser-only.

## Out of Scope

- Manual tab labels/counts as generation constraints, locking a custom generation plan, merging old document bodies, cross-recording grouping, batch export/deployment, new providers, and unrelated settings or layout changes.
