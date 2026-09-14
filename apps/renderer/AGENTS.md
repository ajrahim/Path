# Path renderer

Follow the repository [AGENTS.md](../../AGENTS.md) and the shared
[agent documentation](../../.agents/README.md). This file adds renderer-specific
constraints; do not duplicate the engineering contract here.

## Ownership and boundaries

- Keep renderer TypeScript folders flat: `src/pages`, `src/components`, `src/hooks`,
  `src/state`, and `src/lib`. Do not add feature folders, nested UI folders,
  or a folder for each component. Bridge declarations live at `src/Desktop.d.ts`.
  Styles use the nested ownership structure described below.
- Use PascalCase source, test, and fixture basenames, including helpers, state,
  and declarations. Class files match their main exported class. Preserve suffixes
  such as `.test.ts`, `.integration.test.ts`, and `.d.ts`. Keep one `useCamelCase`
  hook per file in `src/hooks`; follow the shared filename exceptions for framework
  routes, configs, data, public package entries, and generated files. Functions
  and ordinary operations remain camelCase.
- Keep Next Pages Router entries in `src/pages` only. Each PascalCase page directly
  exports its component as default, giving it a matching URL such as `/RecorderPage/`.
  `_app.tsx` owns providers/styles; `_document.tsx` owns the document shell.
  `index.tsx` is the only alias and re-exports `WorkspacePage` for `/`. Do not add
  a root `pages` folder, per-route wrappers, or custom page extensions.
  Use `RENDERER_ROUTES` from `@path/shared` for window and navigation URLs; update
  its values and route checks together when page names change.
- Pages compose components and hooks. Components may import hooks, state, and
  browser helpers, but never pages. Hooks may import state and helpers, never
  presentation. State may import helpers, never hooks or presentation. Keep
  `src/lib` independent of pages, components, hooks, and state. Hooks, state,
  and helpers must not import styles.
- Use the typed `getDesktopApi()` bridge for desktop operations. Do not import
  Electron, Node filesystem APIs, databases, provider SDKs, or desktop service
  implementations into renderer code. Credentials and durable files belong to
  the desktop process.
- Keep browser APIs in effects or event handlers, safe from static rendering. All
  routes must support the static export used by Electron. Browser preview must
  tolerate an unavailable desktop bridge.
- Reuse shared contracts and translation messages. The only public product name
  is **Path**.

## Quality and verification

- Use clear branches for multistate behavior. Comment compatibility requirements,
  timing, resource lifetimes, and coordinate conversions instead of narrating JSX.
- Release subscriptions, timers, observers, tracks, and object URLs. Async work
  must not overwrite a newer selection or update a disposed subscription.
- Keep control labels, focus handling, keyboard interactions, reduced motion, and
  light/dark themes intact. Preserve stylesheet order when removing obsolete
  selectors: the current cascade contains shared layout and responsive overrides.
- Run repository formatting, lint, and type checks. Run relevant tests in `test/`
  for state, geometry, or storage changes, and build the renderer for route or
  framework changes. Inspect affected UI states for visual changes.

## Styles

- `src/styles/index.css` is the single stylesheet entry imported by
  `src/pages/_app.tsx`. Keep it as an ordered import manifest: Tailwind,
  `global.css`, then component and page stylesheets. `global.css` owns app-wide
  tokens, reset rules, and shared defaults; this order preserves their priority
  relative to owner-specific rules.
- Put component rules in `src/styles/components/<Component>.css`, such as
  `Button.css`, and page rules in the sibling `src/styles/pages/<Page>.css`, such
  as `RegionPage.css`. Keep both owner folders directly under `src/styles`.
  Add a file when its owner has styles; do not create empty companion files.
- Keep static presentation in CSS. Inline styles may provide runtime geometry,
  positions, or values that depend on measurements or state. Preserve selector
  behavior, import order, responsive rules, and theme overrides when moving CSS.

## Installed framework guidance

In this workspace, Next is hoisted to `../../node_modules/next`. Resolve its
package directory and read the relevant Pages Router guide under
`dist/docs/02-pages/` before changing framework behavior. A generated guide may
point to shared content under `01-app/`; follow that source and its `PagesOnly`
sections. Do not apply App Router conventions to these Pages Router entries.
Preserve the managed block below.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
