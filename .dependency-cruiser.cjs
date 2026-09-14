const { resolve } = require("node:path");

module.exports = {
  // Enforce process and package ownership at import time, before a native API reaches a browser.
  forbidden: [
    { name: "no-cycles", severity: "error", from: {}, to: { circular: true } },
    { name: "no-unresolved-imports", severity: "error", from: {}, to: { couldNotResolve: true } },
    {
      name: "packages-do-not-import-apps",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "renderer-is-browser-only",
      severity: "error",
      from: { path: "^apps/renderer/src/" },
      to: {
        path: "^(apps/desktop/|packages/(database|transcription|recording-core)/)|(^|/)(electron|better-sqlite3|uiohook-napi)(/|$)",
      },
    },
    {
      name: "browser-and-pure-domains-do-not-import-node",
      severity: "error",
      from: {
        path: "^(apps/renderer/src/|packages/(shared|recording-core|timeline)/src/)",
      },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "pure-domains-do-not-import-runtime-adapters",
      severity: "error",
      from: { path: "^packages/(recording-core|timeline)/src/" },
      to: {
        path: "^(apps/|packages/(database|transcription)/)|(^|/)(electron|better-sqlite3|uiohook-napi)(/|$)",
      },
    },
    {
      name: "shared-contracts-are-browser-safe",
      severity: "error",
      from: { path: "^packages/shared/" },
      to: {
        path: "^(apps/|packages/(?!shared/))|(^|/)(electron|better-sqlite3|uiohook-napi)(/|$)",
      },
    },
    {
      name: "renderer-components-do-not-import-pages",
      severity: "error",
      from: { path: "^apps/renderer/src/components/" },
      to: { path: "^apps/renderer/src/pages/" },
    },
    {
      name: "renderer-hooks-do-not-import-presentation",
      severity: "error",
      from: { path: "^apps/renderer/src/hooks/" },
      to: { path: "^apps/renderer/src/(pages|components|styles)/" },
    },
    {
      name: "renderer-state-does-not-import-consumers",
      severity: "error",
      from: { path: "^apps/renderer/src/state/" },
      to: { path: "^apps/renderer/src/(pages|components|hooks|styles)/" },
    },
    {
      name: "renderer-lib-does-not-import-workflows",
      severity: "error",
      from: { path: "^apps/renderer/src/lib/" },
      to: { path: "^apps/renderer/src/(pages|components|hooks|state|styles)/" },
    },
    {
      name: "desktop-does-not-import-renderer",
      severity: "error",
      from: { path: "^apps/desktop/src/" },
      to: { path: "^apps/renderer/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: "(^|/)(dist|out|\\.next)/",
    tsPreCompilationDeps: true,
    // Resolve the renderer's @/ imports exactly as its TypeScript compiler does.
    tsConfig: { fileName: resolve(__dirname, "apps/renderer/tsconfig.json") },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
  },
};
