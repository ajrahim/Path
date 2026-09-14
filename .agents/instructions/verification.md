# Verification

Run commands from the repository root. Use the installed lockfile and `npm ci` for a fresh checkout.

## Required gates

```sh
npm run check
npm test
npm run build
```

`check` runs Prettier verification, lint, workspace TypeScript checks, architecture checks, and unused-code checks. `npm test` runs the non-integration Vitest suite. Build produces the static renderer export and Electron bundles; it does not launch or validate recording.

For an ordinary focused change, format supported changed files with `npx prettier --write <files>`, run the owning test, then the repository checks. `npm run format` formats all supported source and documentation. Use the full test suite for shared contracts, recording lifecycle, persistence, or broad refactors. For documentation-only changes, formatting and link/source review are sufficient unless executable instructions changed.

| Changed behavior                                                       | Additional evidence                                                                  |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Pure timing, coordinates, correlation, or prompt assembly              | Deterministic Vitest regression at the owning boundary                               |
| SQLite schema/repository or asset deletion                             | Temporary-database/filesystem tests, existing-data handling, and failure-path checks |
| Preload, IPC, renderer protocol, window lifecycle, or packaging inputs | Production build and an appropriate Electron smoke check                             |
| Renderer routing, shared providers, or static asset paths              | `npm run test:renderer` against the production export                                |
| Capture, screenshots, native input, microphone, or playback            | Interactive native check on the affected OS and capture mode                         |
| whisper.cpp wiring                                                     | `npm run test:transcription` on Windows with the required runtime                    |

Tests should assert observable behavior, not mirror implementation details. Prefer fakes and temporary directories over a developer's recordings, credentials, network, or installed models. Keep the default suite independent of native UI and cloud inference.

## Exported renderer smoke check

`npm run test:renderer` builds the renderer and opens the six direct page URLs and the home entry in headless Chrome. It checks page loading, hydration, static assets, Settings client navigation, and browser history using the same nested asset mapping as Electron. Install Chrome or set `PATH_APP_BROWSER_EXECUTABLE` to a Chromium-compatible executable. This check does not launch Electron or capture the desktop; native behavior still needs the checks below.

## Native checks

`better-sqlite3` is used by both Node tests and Electron. `npm test` rebuilds it for the host Node runtime; desktop startup and packaging rebuild it for Electron. If switching manually between those contexts, use `npm run rebuild:native -w @path/desktop` before launching desktop scripts.

With the renderer running at `http://127.0.0.1:3000` in another terminal:

```sh
npm run test:recording
node tests/ElectronCaptureOverlays.mjs
```

For the title-bar script, set the same renderer URL explicitly because its standalone default differs:

```powershell
$env:PATH_APP_RENDERER_URL = "http://127.0.0.1:3000"
node tests/ElectronTitlebar.mjs
Remove-Item Env:PATH_APP_RENDERER_URL
```

These scripts manipulate real windows and capture screen content; use an idle test desktop and inspect each script's profile setup before running it. `npm run test:transcription` can download its verified English model into a temporary test cache and is skipped on non-Windows platforms. These checks are distinct from CI's deterministic suite.

## Review before delivery

Inspect the changed files after formatting for readable control flow, meaningful comments, stale exports, and removed-path residue. Check for leaked credentials, machine-specific paths, recordings, models, generated binaries, and build output. Once version control is initialized, use `git diff --check` and review the diff/status.

Report commands and outcomes accurately, including failures and skipped platform/model checks. Do not put a transient audit count, a passing run, or a release-readiness claim in durable project memory without its date, scope, and evidence. Run `npm audit` when changing dependencies or preparing distribution; do not claim an audit is clean from an older README.
