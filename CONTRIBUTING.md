# Contributing to Path

Start with [README.md](README.md) for setup and [AGENTS.md](AGENTS.md) for the repository's engineering contract. All contributors are expected to uphold our [Code of Conduct](CODE_OF_CONDUCT.md). Please report security and privacy vulnerabilities privately following our [Security Policy](.github/SECURITY.md).

The same ownership, data-safety, and verification expectations apply to human and automated contributions.

## Prerequisites & Native Environment

- **Node.js & npm:** Node.js 22.14 or newer and npm 10 or newer.
- **Native Build Tools:** Building native modules (`better-sqlite3`, `uiohook-napi`) requires platform C++ build tools:
  - **Windows:** Visual Studio 2022 C++ Build Tools and Python 3.
  - **macOS:** Xcode Command Line Tools (`xcode-select --install`).
  - **Linux:** `build-essential`, `python3`, and standard X11/wayland development libraries.
- **Node & Electron ABI:** `better-sqlite3` uses different ABIs for Node tests and Electron packaging. The repository scripts handle rebuilding via `predev` (`npm run rebuild:native -w @path/desktop`) and `pretest` (`npm rebuild better-sqlite3`).

## Code and Architecture Rules

Renderer application pages, components, hooks, state, and helpers live in flat folders under `apps/renderer/src`. Next uses `src/pages` directly, with default component exports, `_app.tsx`, `_document.tsx`, and one `index.tsx` home alias. Keep window/navigation URLs aligned with page filenames through `RENDERER_ROUTES` in `@path/shared`. Authored source, test, fixture, and script basenames use PascalCase; class files match their main exported class. Keep one `useCamelCase` hook per file and preserve test/declaration suffixes. Follow the [engineering contract](.agents/instructions/engineering.md#readability-and-comments) for framework, config, public entry, data, and generated-file exceptions, and the [renderer instructions](apps/renderer/AGENTS.md) for routing and import direction. Functions remain idiomatic camelCase.

Styles use a separate owner-based hierarchy. `src/styles/index.css` imports Tailwind, `global.css` shared defaults, then component and page styles such as `styles/components/Button.css` and `styles/pages/RegionPage.css`. Keep static rules in their owning files and preserve cascade order; computed geometry can remain inline. Create stylesheets only when there are rules to own.

Run these commands before submitting a code change:

```sh
npm run check
npm test
npm run build
```

Use `npx prettier --write <changed-files>` for focused formatting or `npm run format` for a deliberate repository-wide format pass. See [verification](.agents/instructions/verification.md) for native runtime checks and when a documentation-only change needs less validation.

Keep visible breathing room between logical phases of a function or test. ESLint checks a baseline of blank lines; Prettier preserves intentional grouping. Add useful comments about purpose, assumptions, units, lifecycle, and failure behavior, especially around asynchronous workflows and native boundaries. The [readability rules](.agents/instructions/engineering.md#readability-and-comments) apply to scripts and tests as well as application code.

A pull request should explain the problem, the resulting behavior, relevant tests and outcomes, and any remaining platform or provider limitations. Include before/after evidence when changing visible behavior, with all private content removed. A passing build alone is not evidence of working screen capture or cross-platform support.

Update the owning specification or source-linked memory entry when a durable fact changes. Do not add copies of the engineering rules to every directory, speculative scaffolding, transient audit snapshots, generated installers, or local environment files.

Dependency additions should have a concrete runtime or verification purpose. Keep the lockfile in sync, preserve third-party notices in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), and review dependency audit results before distribution. This project is released under the [Apache-2.0 License](LICENSE).
