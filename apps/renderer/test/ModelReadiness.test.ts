import { describe, expect, it } from "vitest";
import type { AvailableAiModels, CliState } from "@path/shared";
import { getModelReadiness } from "../src/lib/ModelReadiness";

const runningModels: AvailableAiModels = {
  api: [],
  local: [
    {
      id: "llama3.2-vision:latest",
      name: "llama3.2-vision:latest",
      sizeBytes: null,
      modifiedAt: null,
      isLoaded: false,
      supportedPurposes: ["visual", "text"],
      supportsEffort: false,
    },
  ],
  ollama: { status: "running", endpoint: "http://127.0.0.1:11434" },
};

const noKeys = { anthropic: false, openai: false, google: false, openrouter: false };

const localSelection = {
  source: "local" as const,
  modelId: "llama3.2-vision:latest",
  modelName: "llama3.2-vision:latest",
};

const baseInput = {
  purpose: "visual" as const,
  selection: localSelection,
  models: runningModels,
  keyStatus: noKeys,
  isLoading: false,
  cli: null,
};

function createCliState(overrides: Partial<CliState>): CliState {
  return {
    mode: "cli",
    connected: ["claude"],
    selection: { tool: "claude", model: "sonnet", effort: null },
    revision: 1,
    tools: [{ id: "claude", installed: true, connected: true, status: "ready", models: [] }],
    ...overrides,
  };
}

describe("getModelReadiness", () => {
  it("reports checking while the catalog loads", () => {
    expect(getModelReadiness({ ...baseInput, isLoading: true })).toEqual({ status: "checking" });
  });

  it("reports an installed local model as ready", () => {
    expect(getModelReadiness(baseInput)).toEqual({
      status: "ready",
      modelName: "llama3.2-vision:latest",
    });
  });

  it("reports Ollama unavailable before checking installed models", () => {
    const models: AvailableAiModels = {
      api: [],
      local: [],
      ollama: { status: "unavailable", endpoint: "http://127.0.0.1:11434" },
    };

    expect(getModelReadiness({ ...baseInput, models }).status).toBe("ollama-unavailable");
  });

  it("names the model to pull when Ollama is running without it", () => {
    const models = { ...runningModels, local: [] };

    expect(getModelReadiness({ ...baseInput, models })).toEqual({
      status: "model-missing",
      modelName: "llama3.2-vision:latest",
      modelId: "llama3.2-vision:latest",
    });
  });

  it("requires the provider key for an API selection", () => {
    const selection = {
      source: "api" as const,
      provider: "anthropic" as const,
      modelId: "claude",
      modelName: "Claude",
    };

    expect(getModelReadiness({ ...baseInput, selection })).toEqual({
      status: "key-missing",
      modelName: "Claude",
      provider: "anthropic",
    });
    expect(
      getModelReadiness({ ...baseInput, selection, keyStatus: { ...noKeys, anthropic: true } }),
    ).toEqual({ status: "ready", modelName: "Claude" });
  });

  it("reports a missing selection", () => {
    expect(getModelReadiness({ ...baseInput, selection: null }).status).toBe("not-chosen");
  });

  it("uses the CLI tool for text generation only while CLI mode is on", () => {
    const models = { ...runningModels, local: [] };
    const cli = createCliState({});

    expect(getModelReadiness({ ...baseInput, purpose: "text", models, cli })).toEqual({
      status: "ready",
      modelName: "Claude Code",
    });
    expect(getModelReadiness({ ...baseInput, purpose: "visual", models, cli }).status).toBe(
      "model-missing",
    );
    expect(
      getModelReadiness({ ...baseInput, purpose: "text", models, cli: { ...cli, mode: "model" } })
        .status,
    ).toBe("model-missing");
  });

  it("reports a CLI tool that is not signed in", () => {
    const cli = createCliState({
      tools: [
        {
          id: "claude",
          installed: true,
          connected: true,
          status: "sign-in-required",
          models: [],
        },
      ],
    });

    expect(getModelReadiness({ ...baseInput, purpose: "text", cli })).toEqual({
      status: "cli-unavailable",
      modelName: "Claude Code",
    });
  });
});
