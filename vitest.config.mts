import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./apps/renderer/src", import.meta.url)) } },
  test: {
    include: ["apps/*/test/**/*.test.{ts,tsx}", "packages/*/test/**/*.test.ts"],
    // Model downloads and native integration checks have their own explicit commands.
    exclude: ["**/*.integration.test.ts"],
  },
});
