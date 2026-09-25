# Verification

Run commands from the repository root.

## Required verification gates

```sh
npm run check    # Prettier, ESLint, TypeScript across all workspaces, dependency-cruiser, Knip
npm test         # Vitest unit and component test suite
npm run build    # Next.js static export & Electron main/preload/database-worker bundling
```

## Focused verification matrix

| Scope of Change                                 | Primary Verification Commands                                                                                                 |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Formatting & style                              | `npx prettier --write <files>` or `npm run format`                                                                            |
| Contracts, math, state, timeline correlation    | `npx vitest run <path-to-test>` (fast in-memory)                                                                              |
| Database schema, repositories, assets           | `npx vitest run packages/database/test apps/desktop/test/DatabaseClient.test.ts apps/desktop/test/AssetDeletionQueue.test.ts` |
| Storage performance (imports, queries, history) | `npm run measure:persistence` (add `--electron` after `npm run rebuild:native -w @path/desktop`)                              |
| Renderer routing, static assets, hydration      | `npm run test:renderer` (Headless Chromium check)                                                                             |
| Audio transcription & whisper.cpp model         | `npm run test:transcription` (Windows x64 with real audio synthesis)                                                          |
| Native screen capture & overlays                | `npm run test:recording` and `node tests/ElectronCaptureOverlays.mjs`                                                         |
| Native window caption & acrylic glass           | `node tests/ElectronTitlebar.mjs`                                                                                             |
| Release versioning & PR generation              | `npm run push <patch                                                                                                          | minor | major | x.y.z>`or`npm run version:bump` |

## Native environment notes

- **ABI Rebuilds:** `better-sqlite3` uses distinct ABIs for Node tests and Electron. The build pipeline handles rebuilding via `predev` (`npm run rebuild:native -w @path/desktop`) and `pretest` (`npm rebuild better-sqlite3`).
- **File Locks on Windows:** Ensure running Electron desktop processes are terminated before running `npm test` so `better_sqlite3.node` is not locked (`EBUSY`).
- **Schema Baseline:** A development database created before `0000_baseline` is refused at startup without changes. Close Path and run `npm run db:reset -- --confirm` to move it into the profile's `backups/` folder.
- **Worker Bundle:** Tests that start the real database worker bundle `DatabaseWorker.ts` with esbuild into `node_modules/.cache/path-tests/`; they need the Node build of `better-sqlite3`.
- **Interactive Windows:** Native integration scripts (`tests/*.mjs`) launch real Electron windows; run on an idle desktop display.

## Pre-delivery checklist

1. Run `npm run check` (0 errors, 0 warnings, 0 unused exports).
2. Run `npm test` (all tests passing).
3. Verify no private credentials, temporary recordings, `.env` files, or local user paths are staged.
