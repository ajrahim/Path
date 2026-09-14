import { defineConfig } from "vitest/config";

// Native speech/model checks stay opt-in rather than joining the default deterministic suite.
export default defineConfig({ test: { include: ["test/**/*.integration.test.ts"] } });
