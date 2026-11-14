# Structured Document Generation

Status: Active

## Goal

Generate complete, evidence-grounded documents from a recording in two reasoning passes: the first decides the document set and each document's content structure, the second writes every document from that structure. Strong specifications are the primary target; every instruction flow uses the same path.

## User Experience

1. User records or imports a walkthrough, selects an instruction flow, keeps the existing Combine/Split choice, and clicks Generate. No control, label, or layout changes.
2. Path plans the structure: as many documents as the evidence supports in Split, exactly one in Combine. Each planned document has a title, scope, evidence time ranges, and ordered sections with the evidence each must cover.
3. Path writes each planned document in full and shows the result only after every document is complete.
4. A plan or document that is invalid, truncated, or missing planned sections is retried once, then fails with a recoverable error that keeps the prior documents.

## Requirements

- Pass 1 returns one validated JSON structure plan: shared context plus 1-24 uniquely titled documents, each with a scope, evidence time ranges in seconds, and uniquely headed sections with coverage notes. Combine requires exactly one document.
- Accept a plan wrapped in a Markdown fence or surrounding prose. Retry an invalid plan once with the validation problem; a second invalid plan fails without committing anything.
- Pass 2 writes one document per planned document from the selected instructions, its sections, the shared context, the sibling documents' titles and scopes, and recorded activity that prioritizes its own evidence time ranges.
- A written document must contain every planned section heading. Missing sections trigger one rewrite; a second incomplete or an empty document fails the whole generation.
- Text generation reads each provider's stop reason. Output cut off at the token limit is continued rather than committed; a response that spends its whole budget before writing fails with a clear error.
- Recorded speech and clicks beyond the prompt limit are sampled across the whole recording instead of dropping its end.
- Treat recording content, the plan, and shared context as evidence or organization, never as instructions or new facts.
- Split, Combine, app-link generation, and workflow suggestions share the planner. Existing atomic commit, plan-version check, identity reuse, and history behavior are unchanged.

## Acceptance Criteria

- [x] Split generation issues one plan request and one write request per planned document; each write prompt contains that document's sections, scope, shared context, and sibling titles. **PASS:** `GuideDocumentService.test.ts`, `DocumentStructurePlan.test.ts`.
- [x] Combine and single-document generation issue one plan request constrained to one document, then one write request. **PASS:** combine cases and the `generate` case in `GuideDocumentService.test.ts`.
- [x] A fenced or prose-wrapped plan is accepted; an invalid plan is retried once and a second invalid plan leaves prior tabs, plan version, and documents intact. **PASS:** `GuideDocumentService.test.ts`, parsing cases in `DocumentStructurePlan.test.ts`.
- [x] A document missing a planned section is rewritten once; a second incomplete document commits nothing. **PASS:** `GuideDocumentService.test.ts`.
- [x] Truncated Anthropic, OpenAI, OpenRouter, Google, and Ollama responses are continued and joined; an empty truncated response is rejected. **PASS:** `SelectedAiService.test.ts`, `OllamaClickActionAnalyzer.test.ts`.
- [x] A recording with more than 300 speech and click entries keeps entries from its start through its end in the planning prompt, and a document's own time range is kept at full density in its write prompt. **PASS:** `DocumentPrompt.test.ts`, 600-entry case in `GuideDocumentService.test.ts`.
- [x] Spec Document, Help Guide, Provide Feedback, and custom flows pass in both modes. **PASS:** eight parameterized cases in `GuideDocumentService.test.ts`.
- [x] `npm run check`, `npm test`, and `npm run build` pass. **PASS:** formatting, lint, all workspace types, architecture, Knip; 111 test files / 813 tests; renderer export and desktop bundling.

## Verification Evidence

- Provider behavior in the automated tests is deterministic fixtures: stop reasons, request limits, plans, and document bodies.
- Live check on 2026-11-12 against local Ollama `gpt-oss` (20.9B) with the built-in Spec Document flow and an 11-utterance, 7-click sign-in and registration walkthrough, using the real service, prompts, and Ollama client with in-process SQLite. Split planned two documents and wrote both with every planned section; Combine planned one and wrote it in two requests. Requests took 94-212 s each, 4.5-9 minutes per generation.
- The live runs led to three corrections that are now covered by tests: the write prompt no longer leaks its sibling list into a document, section headings match despite typographic hyphens and quotes, and the title line is stated explicitly.
- Not verified: live Anthropic, OpenAI, OpenRouter, and Google requests, including the reasoning headroom and continuation joins; CLI tool generation; recordings long enough to exceed the 300-entry budget with a live model.

## Constraints

- No renderer, IPC channel, or database schema changes. The structure plan is not persisted; the stored workflow plan keeps only title and scope.
- Document requests ask for up to 8,192 output tokens with a 5-minute timeout and at most two continuations. Models that reject an 8,192-token limit cannot generate documents.
- Reasoning tokens count against provider output limits, so reasoning requests add headroom for the selected effort.
- Imported log and element rows stay sampled across the video (200 rows); only speech and clicks are prioritized by time range.

## Technical Notes

- `apps/desktop/src/ai/DocumentStructurePlan.ts` owns the plan and write prompts, plan parsing, and the section completeness check; `DocumentPrompt.ts` keeps activity evidence and the base prompts.
- `GuideDocumentService` orchestrates the two passes; `SelectedAiService.generateText` owns stop-reason handling and continuation for cloud and Ollama models. CLI tools have no output limit to continue.
- The plan schema lives beside the other generation schemas in `packages/shared/src/Ipc.ts`.

## Out of Scope

- UI changes, a visible or editable outline, persisting the structure plan, and new IPC channels or migrations.
- Changing the built-in instruction flow texts, adding providers, streaming, or parallel document generation.
- Ollama context-window (`num_ctx`) configuration and per-range imported log queries.
