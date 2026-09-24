// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import messages from "@path/shared/messages/en.json";
import type { AiModelPurpose } from "@path/shared";
import { LocalModelSelect } from "../src/components/LocalModelSelect";
import { useAiModels } from "../src/hooks/useAiModels";

const selectModel = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const openKeySettings = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const configuredModels = vi.hoisted(() => ({
  models: {
    api: [
      {
        id: "cloud-vision",
        name: "Cloud Vision",
        provider: "openai" as const,
        vendor: null,
        contextLength: null,
        pricing: null,
        isFree: false,
        supportedPurposes: ["visual", "text"] as AiModelPurpose[],
        supportsEffort: false,
      },
      {
        id: "router/vision-pro",
        name: "Vision Pro",
        provider: "openrouter" as const,
        vendor: "router",
        contextLength: 128000,
        pricing: { promptPerMillion: 1.5, completionPerMillion: 6 },
        isFree: false,
        supportedPurposes: ["visual", "text"] as AiModelPurpose[],
        supportsEffort: false,
      },
      {
        id: "cloud-text",
        name: "Cloud Text",
        provider: "openai" as const,
        vendor: null,
        contextLength: null,
        pricing: null,
        isFree: false,
        supportedPurposes: ["text"] as AiModelPurpose[],
        supportsEffort: false,
      },
    ],
    local: [
      {
        id: "llama:latest",
        name: "Llama Vision",
        sizeBytes: 5_200_000_000,
        modifiedAt: "2026-09-01T00:00:00.000Z",
        isLoaded: true,
        supportedPurposes: ["visual", "text"] as AiModelPurpose[],
        supportsEffort: false,
      },
      {
        id: "gemma:latest",
        name: "Gemma",
        sizeBytes: null,
        modifiedAt: null,
        isLoaded: false,
        supportedPurposes: ["visual", "text"] as AiModelPurpose[],
        supportsEffort: false,
      },
      {
        id: "writer:latest",
        name: "Writer",
        sizeBytes: null,
        modifiedAt: null,
        isLoaded: false,
        supportedPurposes: ["text"] as AiModelPurpose[],
        supportsEffort: false,
      },
    ],
    ollama: { status: "running" as const, endpoint: "http://127.0.0.1:11434" },
  },
  keyStatus: { openai: true, google: false, anthropic: false, openrouter: false },
  selections: {
    visual: { source: "local" as const, modelId: "llama:latest", modelName: "Llama Vision" },
    text: { source: "local" as const, modelId: "writer:latest", modelName: "Writer" },
  },
  isLoading: false,
  isSaving: false,
  error: null,
  refreshModels: vi.fn(),
  selectModel,
  openKeySettings,
}));

vi.mock("../src/hooks/useAiModels", () => ({
  useAiModels: vi.fn(() => configuredModels),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.mocked(useAiModels).mockReturnValue(configuredModels);
});
function setup() {
  const view = render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <LocalModelSelect disabled={false} />
    </NextIntlClientProvider>,
  );

  fireEvent.click(view.getByRole("button", { name: "Visual" }));

  return view;
}

it("searches local model IDs and API provider names, then selects the matching API model", async () => {
  const view = setup();
  const search = view.getByRole("textbox", { name: messages.navigation.searchModels });

  expect(document.activeElement).toBe(search);
  fireEvent.change(search, { target: { value: " LLAMA: " } });
  expect(view.getByRole("menuitemradio", { name: /^Llama Vision/ })).toBeTruthy();
  expect(view.queryByRole("menuitemradio", { name: "Gemma" })).toBeNull();
  fireEvent.change(search, { target: { value: "openai" } });
  expect(view.getByRole("button", { name: /^OpenAI/ }).getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(view.getByRole("menuitemradio", { name: "Cloud Vision" }));
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  expect(selectModel).toHaveBeenCalledWith("visual", {
    source: "api",
    provider: "openai",
    modelId: "cloud-vision",
    modelName: "Cloud Vision",
  });
  expect(document.activeElement).toBe(view.getByRole("button", { name: "Visual" }));
});

it("opens Settings on the API keys page when no provider keys are configured", () => {
  vi.mocked(useAiModels).mockReturnValue({
    ...configuredModels,
    models: {
      api: [],
      local: configuredModels.models.local,
      ollama: configuredModels.models.ollama,
    },
    keyStatus: { openai: false, google: false, anthropic: false, openrouter: false },
  });

  const view = setup();

  fireEvent.click(view.getByRole("button", { name: "Configure API keys in Settings" }));
  expect(openKeySettings).toHaveBeenCalled();
  expect(view.queryByRole("dialog")).toBeNull();
});

it("handles no results, clears the query, and resets it when reopening without changing selection", () => {
  const view = setup();
  const search = view.getByRole("textbox", { name: messages.navigation.searchModels });

  fireEvent.change(search, { target: { value: "missing-model" } });
  expect(view.getByRole("status").textContent).toBe("No matching models");
  fireEvent.click(view.getByRole("button", { name: "Clear model search" }));
  expect(document.activeElement).toBe(search);
  expect(
    view.getByRole("menuitemradio", { name: /^Llama Vision/ }).getAttribute("aria-checked"),
  ).toBe("true");
  fireEvent.change(search, { target: { value: "gemma" } });
  fireEvent.keyDown(search, { key: "Escape" });
  expect(view.queryByRole("dialog")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Visual" }));
  expect(
    (view.getByRole("textbox", { name: messages.navigation.searchModels }) as HTMLInputElement)
      .value,
  ).toBe("");
  expect(selectModel).not.toHaveBeenCalled();
});

it("shows installed size and loaded state for local models", () => {
  const view = setup();

  const llama = view.getByRole("menuitemradio", { name: /^Llama Vision/ });

  expect(llama.textContent).toBe("Llama Vision");
  expect(llama.getAttribute("title")).toMatch(/4\.8 GB · .+ · Loaded/);
  expect(
    view.getByText("Ollama is running").closest(".local-model-status")?.getAttribute("title"),
  ).toBe("http://127.0.0.1:11434");
});

it("distinguishes a down Ollama daemon from an empty vision model list", () => {
  vi.mocked(useAiModels).mockReturnValue({
    ...configuredModels,
    models: {
      api: [],
      local: [],
      ollama: { status: "unavailable", endpoint: "http://127.0.0.1:11434" },
    },
    selections: { visual: null, text: null },
  });

  const down = setup();

  expect(down.getByText("Ollama is unavailable")).toBeTruthy();
  expect(down.queryByText("No local vision models found")).toBeNull();
  cleanup();

  vi.mocked(useAiModels).mockReturnValue({
    ...configuredModels,
    models: {
      api: [],
      local: [],
      ollama: { status: "running", endpoint: "http://127.0.0.1:11434" },
    },
    selections: { visual: null, text: null },
  });

  const empty = setup();

  expect(empty.getByText("Ollama is running")).toBeTruthy();
  expect(empty.getByText("No local vision models found")).toBeTruthy();
});

it("warns when the saved local selection is no longer installed", () => {
  vi.mocked(useAiModels).mockReturnValue({
    ...configuredModels,
    selections: {
      ...configuredModels.selections,
      visual: { source: "local", modelId: "gone:latest", modelName: "Gone" },
    },
  });

  const view = setup();

  expect(view.getByRole("alert").textContent).toContain(
    "Selected visual model is no longer installed",
  );
});

it("shows OpenRouter pricing and routes keyless selection to Settings", async () => {
  const view = setup();
  const provider = view.getByRole("button", { name: /^OpenRouter/ });

  expect(provider.textContent).toContain("OpenRouter (No Key)");
  fireEvent.click(provider);
  expect(view.queryByText("Requires an OpenRouter API key")).toBeNull();

  const visionPro = view.getByRole("menuitemradio", { name: /Vision Pro/ });

  expect(visionPro.textContent).toBe("Vision Pro");
  expect(visionPro.getAttribute("title")).toBe(
    "router · $1.5 in · $6 out / 1M tokens · 128K context",
  );
  fireEvent.click(view.getByRole("menuitemradio", { name: /Vision Pro/ }));

  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  expect(openKeySettings).toHaveBeenCalled();
  expect(selectModel).not.toHaveBeenCalled();
});

it("selects an OpenRouter model directly once its key is configured", async () => {
  vi.mocked(useAiModels).mockReturnValue({
    ...configuredModels,
    keyStatus: { openai: true, google: false, anthropic: false, openrouter: true },
  });

  const view = setup();
  const provider = view.getByRole("button", { name: /^OpenRouter/ });

  expect(provider.textContent).not.toContain("No Key");
  fireEvent.click(provider);
  expect(view.queryByText("Requires an OpenRouter API key")).toBeNull();
  fireEvent.click(view.getByRole("menuitemradio", { name: /Vision Pro/ }));

  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  expect(selectModel).toHaveBeenCalledWith("visual", {
    source: "api",
    provider: "openrouter",
    modelId: "router/vision-pro",
    modelName: "Vision Pro",
  });
  expect(openKeySettings).not.toHaveBeenCalled();
});

it("opens separate purpose pickers and saves only the chosen purpose", async () => {
  const view = setup();
  const visualTrigger = view.getByRole("button", { name: "Visual" });
  const textTrigger = view.getByRole("button", { name: "Text" });

  expect(visualTrigger.textContent).toBe("Llama Vision");
  expect(textTrigger.textContent).toBe("Writer");
  expect(visualTrigger.getAttribute("title")).toBe("Visual: Llama Vision");
  expect(textTrigger.getAttribute("title")).toBe("Text: Writer");
  expect(visualTrigger.getAttribute("aria-expanded")).toBe("true");
  expect(textTrigger.getAttribute("aria-expanded")).toBe("false");
  expect(view.queryByRole("tablist")).toBeNull();
  expect(view.queryByRole("menuitemradio", { name: "Writer" })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: /^OpenAI/ }));
  expect(view.queryByRole("menuitemradio", { name: "Cloud Text" })).toBeNull();

  fireEvent.click(textTrigger);
  expect(view.getAllByRole("dialog")).toHaveLength(1);
  expect(visualTrigger.getAttribute("aria-expanded")).toBe("false");
  expect(textTrigger.getAttribute("aria-expanded")).toBe("true");
  expect(view.getByRole("menuitemradio", { name: "Writer" }).getAttribute("aria-checked")).toBe(
    "true",
  );
  expect(
    view.getByRole("menuitemradio", { name: /^Llama Vision/ }).getAttribute("aria-checked"),
  ).toBe("false");
  fireEvent.click(view.getByRole("button", { name: /^OpenAI/ }));
  fireEvent.click(view.getByRole("menuitemradio", { name: "Cloud Text" }));

  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  expect(selectModel).toHaveBeenCalledTimes(1);
  expect(selectModel).toHaveBeenCalledWith("text", {
    source: "api",
    provider: "openai",
    modelId: "cloud-text",
    modelName: "Cloud Text",
  });
  expect(document.activeElement).toBe(textTrigger);
});

it("resets search on purpose switch and returns focus to the active trigger on Escape", () => {
  const view = setup();
  const visualTrigger = view.getByRole("button", { name: "Visual" });
  const textTrigger = view.getByRole("button", { name: "Text" });
  const search = view.getByRole("textbox", { name: messages.navigation.searchModels });

  fireEvent.change(search, { target: { value: "missing" } });
  fireEvent.click(textTrigger);
  expect((search as HTMLInputElement).value).toBe("");
  expect(document.activeElement).toBe(search);
  fireEvent.keyDown(search, { key: "Escape" });
  expect(view.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(textTrigger);

  fireEvent.click(visualTrigger);
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(view.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(visualTrigger);
  expect(selectModel).not.toHaveBeenCalled();
});

it("disables both model pickers during recording", () => {
  const view = render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <LocalModelSelect disabled />
    </NextIntlClientProvider>,
  );

  for (const name of ["Visual", "Text"]) {
    const trigger = view.getByRole("button", { name });

    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(trigger);
  }

  expect(view.queryByRole("dialog")).toBeNull();
});

it("does not label a selected local model uninstalled while Ollama is unavailable", () => {
  vi.mocked(useAiModels).mockReturnValue({
    ...configuredModels,
    models: {
      ...configuredModels.models,
      local: [],
      ollama: { status: "unavailable", endpoint: "http://127.0.0.1:11434" },
    },
  });

  const view = setup();

  expect(view.getByText("Ollama is unavailable")).toBeTruthy();
  expect(view.queryByRole("alert")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Text" }));
  expect(view.queryByRole("alert")).toBeNull();
});

it("uses the active purpose for empty and unavailable model messages", () => {
  vi.mocked(useAiModels).mockReturnValue({
    ...configuredModels,
    models: { ...configuredModels.models, api: [], local: [] },
    selections: {
      visual: null,
      text: { source: "api", provider: "openai", modelId: "gone", modelName: "Gone" },
    },
  });

  const view = setup();

  expect(view.getByText("No local vision models found")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Text" }));
  expect(view.getByText("No local text models found")).toBeTruthy();
  expect(view.getByRole("alert").textContent).toContain("Selected text model is unavailable");
  fireEvent.click(view.getByRole("button", { name: /^OpenAI/ }));
  expect(view.getByText("No text models are available.")).toBeTruthy();
});

it("shows an empty role catalog when OpenRouter is configured without compatible models", () => {
  vi.mocked(useAiModels).mockReturnValue({
    ...configuredModels,
    models: { ...configuredModels.models, api: [] },
    keyStatus: { openai: false, google: false, anthropic: false, openrouter: true },
  });

  const view = setup();

  expect(view.getByText("No visual models are available.")).toBeTruthy();
  expect(view.queryByRole("button", { name: "Configure API keys in Settings" })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Text" }));
  expect(view.getByText("No text models are available.")).toBeTruthy();
});
