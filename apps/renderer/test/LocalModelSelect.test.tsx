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
      },
      {
        id: "gemma:latest",
        name: "Gemma",
        sizeBytes: null,
        modifiedAt: null,
        isLoaded: false,
        supportedPurposes: ["visual", "text"] as AiModelPurpose[],
      },
      {
        id: "writer:latest",
        name: "Writer",
        sizeBytes: null,
        modifiedAt: null,
        isLoaded: false,
        supportedPurposes: ["text"] as AiModelPurpose[],
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

  fireEvent.click(view.getByRole("button", { name: "Select AI model" }));

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
  expect(document.activeElement).toBe(view.getByRole("button", { name: "Select AI model" }));
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
  fireEvent.click(view.getByRole("button", { name: "Select AI model" }));
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

it("shows each purpose's current selection and only offers compatible models", async () => {
  const view = setup();
  const visualTab = view.getByRole("tab", { name: "Visual" });
  const textTab = view.getByRole("tab", { name: "Text" });

  const trigger = view.getByRole("button", { name: "Select AI model" });

  expect(trigger.textContent).toBe("Llama VisionWriter");
  expect(trigger.getAttribute("title")).toBe("Visual: Llama Vision | Text: Writer");
  expect(trigger.querySelector(".local-model-trigger-divider")).toBeTruthy();
  expect(visualTab.textContent).toBe("VisualLlama Vision");
  expect(textTab.textContent).toBe("TextWriter");
  expect(visualTab.getAttribute("aria-selected")).toBe("true");
  expect(view.queryByRole("menuitemradio", { name: "Writer" })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: /^OpenAI/ }));
  expect(view.queryByRole("menuitemradio", { name: "Cloud Text" })).toBeNull();

  fireEvent.click(textTab);
  expect(textTab.getAttribute("aria-selected")).toBe("true");
  expect(view.getByRole("menuitemradio", { name: "Writer" }).getAttribute("aria-checked")).toBe(
    "true",
  );
  expect(
    view.getByRole("menuitemradio", { name: /^Llama Vision/ }).getAttribute("aria-checked"),
  ).toBe("false");
  fireEvent.click(view.getByRole("menuitemradio", { name: "Cloud Text" }));

  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  expect(selectModel).toHaveBeenCalledWith("text", {
    source: "api",
    provider: "openai",
    modelId: "cloud-text",
    modelName: "Cloud Text",
  });
});

it("supports arrow, Home, and End navigation between purpose tabs and returns focus on Escape", () => {
  const view = setup();
  const visualTab = view.getByRole("tab", { name: "Visual" });
  const textTab = view.getByRole("tab", { name: "Text" });
  const search = view.getByRole("textbox", { name: messages.navigation.searchModels });

  fireEvent.change(search, { target: { value: "missing" } });
  visualTab.focus();
  fireEvent.keyDown(visualTab, { key: "ArrowRight" });
  expect(document.activeElement).toBe(textTab);
  expect(textTab.getAttribute("tabindex")).toBe("0");
  expect(visualTab.getAttribute("tabindex")).toBe("-1");
  expect((search as HTMLInputElement).value).toBe("");
  expect(view.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(textTab.id);
  expect(view.getByRole("tabpanel").id).toBe(textTab.getAttribute("aria-controls"));

  fireEvent.keyDown(textTab, { key: "ArrowRight" });
  expect(document.activeElement).toBe(visualTab);
  fireEvent.keyDown(visualTab, { key: "End" });
  expect(document.activeElement).toBe(textTab);
  fireEvent.keyDown(textTab, { key: "Home" });
  expect(document.activeElement).toBe(visualTab);
  fireEvent.keyDown(visualTab, { key: "ArrowLeft" });
  expect(document.activeElement).toBe(textTab);
  fireEvent.keyDown(textTab, { key: "Escape" });
  expect(view.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(view.getByRole("button", { name: "Select AI model" }));
  expect(selectModel).not.toHaveBeenCalled();
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
  fireEvent.click(view.getByRole("tab", { name: "Text" }));
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
  fireEvent.click(view.getByRole("tab", { name: "Text" }));
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
  fireEvent.click(view.getByRole("tab", { name: "Text" }));
  expect(view.getByText("No text models are available.")).toBeTruthy();
});
