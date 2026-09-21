# Engineering contract

## Objective and identity

Maintain one understandable implementation of each behavior. Optimize for correctness and data safety, clear ownership, simplicity, readability, then local style. The repository must communicate intent mechanically while remaining natural, readable, and maintainable for human engineers and modern coding agents. Human readability takes priority over cleverness, excessive abstraction, or AI-specific optimization. Fix broken invariants rather than masking them with broad catches, duplicate state, or fallback branches.

The app's only product name is **Path**. Use `@path/*` workspace names and `PATH_APP_*` application environment variables; never repurpose the operating system's `PATH` variable.

## 1. Architecture and folder structure

- Follow the [architecture map](Architecture.md). Organize directories by clear architectural responsibilities and domain ownership:
  - `apps/desktop/`: Electron process composition, window orchestration, native capture, local AI service, and secure credential storage.
  - `apps/renderer/`: Statically exported Next.js Pages Router application, browser UI, and local workflow state.
  - `packages/shared/`: Browser-safe contracts, Zod boundary schemas, IPC channels, and translation catalogs.
  - `packages/recording-core/`: Deterministic state machines, monotonic session clock, and coordinate mapping (zero I/O).
  - `packages/timeline/`: Pure timeline and transcript/click correlation (zero I/O).
  - `packages/database/`: SQLite schema, migrations, connection, and typed repositories.
  - `packages/transcription/`: Transcription provider interfaces and local whisper.cpp runtime adapter.
- Avoid vague dumping grounds (`Utils/`, `Helpers/`, `Misc/`, `Common/`). Place functionality where an engineer or AI agent can infer ownership without searching the entire repository.
- Keep renderer TypeScript flat: `src/pages`, `src/components`, `src/hooks`, `src/state`, and `src/lib`. Next Pages Router uses `src/pages` directly with PascalCase filenames (`WorkspacePage.tsx`, `RecorderPage.tsx`), alongside `_app.tsx` and `_document.tsx`. The sole alias `index.tsx` re-exports `WorkspacePage` for `/`. Shared route paths live in `packages/shared/src/RendererRoutes.ts`.
- Dependencies point inward from applications to package APIs. Packages must not import applications. Do not add dependency cycles, cross-package relative imports, or imports of private internal package source.
- Do not create unnecessary abstraction layers solely for architectural purity.

## 2. Readability, control flow, and naming

- **Control-Flow Clarity:** Code should be immediately understandable. Prefer guard clauses and early returns over deep nesting. Make data transformations and state transitions explicit. Avoid dense one-liners, deeply nested ternaries, and excessive method chaining that obscure control flow.
- **Naming Conventions:**
  - **PascalCase:** Classes, class files, types, interfaces, enums, React components, domain models, services, repositories, and substantial named concepts (`SessionClock.ts`, `SelectedAiService.ts`, `RecordingRepository.ts`). Class files match their primary exported class.
  - **camelCase:** Variables, local constants, functions, methods, parameters, and object properties (`sessionId`, `createRecordingSession()`, `replayMissingEvents()`).
  - **UPPER_SNAKE_CASE:** True global/static operational constants (`MAX_CLICK_ANALYSES_PER_RECORDING`, `MINIMUM_RECORDING_DURATION_MS`). Do not use for local variables.
  - **Booleans:** Name booleans as natural predicates (`isRecording`, `hasExpired`, `canReconnect`, `shouldPersist`, `wasRecovered`). Avoid ambiguous names like `statusFlag` or `check`.
  - **Files:** Use descriptive PascalCase basenames for authored source, tests, fixtures, and scripts. Hooks use `useCamelCase.ts` (one hook per file). Follow ecosystem exceptions for `package.json`, `tsconfig.json`, `next.config.ts`, `index.ts`, and config files.
- **Domain & Action Naming:** Functions describe the action they perform (`createRecording()`, `extractAudio()`, `validateProviderKey()`). Avoid vague names like `process()`, `handle()`, `doWork()` unless the surrounding type makes the meaning unambiguous. Prefer specific domain nouns over generic terms (`Manager`, `Helper`, `Thing`, `Data`).
- **Repeated Business Logic:** Extract repeated domain rules or conditions into meaningful, named predicate functions (e.g. `needsClickActionAnalysis(description)`) rather than duplicating complex inline logic.
- **Breathing Room:** Separate logical phases (setup, validation, execution, state updates, return) with single blank lines. Let Prettier own mechanical formatting while preserving intentional phase grouping.

## 3. Strong typing, contracts, and schemas

- **Strict Types:** Eliminate unnecessary `any`, un-narrowed `unknown`, or loosely shaped dictionaries. Use discriminated unions, explicit interfaces, typed errors, and typed configs to make invalid states impossible to represent.
- **Authoritative Schemas:** Define explicit contracts at system boundaries using Zod, typed DTOs, and Drizzle database schemas. Prioritize schemas for:
  - IPC payloads and desktop capabilities (`packages/shared/src/Ipc.ts`).
  - Stored settings and persisted models (`packages/shared/src/Contracts.ts`).
  - AI model inputs and structured outputs (`apps/desktop/src/ai/`).
  - Database entities and migrations (`packages/database/src/Schema.ts`).
- **Boundary Validation:** Treat renderer messages, provider responses, stored JSON, filenames, and captured text as untrusted. Validate all IPC input in the main process using strict Zod schemas before touching native services.
- **Safe Secrets & Storage:** API keys stay encrypted in the desktop's `AiCredentialStore` via Electron `safeStorage`. Return key-presence status to the renderer, never plaintext credentials.

## 4. Side-effect boundaries, configuration, and canonical patterns

- **Side-Effect Separation:** Keep pure domain logic (`packages/recording-core`, `packages/timeline`) strictly separated from infrastructure I/O (Electron, SQLite, filesystem, network). Pure logic must remain testable without launching infrastructure.
- **Centralized Configuration:** Avoid magic numbers for operational behavior (timeouts, retry limits, model tokens, buffer sizes). Keep operationally significant constants named and defined in clear configuration locations.
- **Environment Contract:** Treat `.env.example` as part of the public developer contract. Document all `PATH_APP_*` variables with their purpose, format, and defaults. Validate environment overrides at startup.
- **Canonical Patterns:** Maintain one canonical approach for cross-cutting concerns (one IPC bridge structure, one error handling pattern, one media processing pipeline). Do not introduce competing patterns without a clear architectural need.
- **Dead & Legacy Code:** Remove unused files, obsolete shims, commented-out code, and dead experiments promptly. If a deprecated API must remain temporarily, mark it explicitly with `@deprecated`.

## 5. Executable specifications and delivery

- **Tests as Specifications:** Tests describe externally meaningful behavior, contract invariants, and workflow outcomes, not internal implementation trivia.
- **Test Organization:** Test filenames mirror the subject under test (`RecordingMediaServer.test.ts`, `SelectedAiService.test.ts`). Integration tests exercise end-to-end scenarios (capture lifecycle, TTS-to-transcription inference, headless renderer navigation).
- **Deterministic Tooling:** Standard npm commands own all workflows:
  - `npm run dev`: Starts Next dev server and launches Electron desktop.
  - `npm run check`: Runs formatting check, ESLint, TypeScript across all packages, dependency-cruiser architecture rules, and Knip unused code detection.
  - `npm test`: Runs fast Vitest unit/component suite.
  - `npm run build`: Builds Next static export and compiles desktop bundles.
- **Concise Documentation:** Maintain concise, source-linked documentation under `.agents/` (architecture, specs, state management, verification, decisions). Link to canonical rules rather than copying them across folders.

## Delivery

Trace the requested behavior through its owners before editing. Make the smallest complete change and remove superseded code, imports, types, dependencies, fixtures, and documentation in that path. Preserve unrelated user edits and data.

Edit source, then regenerate outputs. Do not hand-edit `node_modules/`, `dist/`, `.next/`, `out/`, `release/`, coverage, or TypeScript build caches. Database migrations are versioned source history: add a migration for a schema change rather than rewriting an applied migration.

Follow [verification](Verification.md), inspect the final diff, and report what changed, what actually passed, and what remains unverified. A successful build does not prove native capture, model readiness, cross-platform support, or release signing. Do not commit personal paths, local media, credentials, model caches, or generated installers. Publishing and licensing decisions must come from the repository owner, not an inferred cleanup task.
