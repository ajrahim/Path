// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DesktopSettings } from "@path/shared";
import { useAiModels } from "../src/hooks/useAiModels";

const bridge = vi.hoisted(() => ({
  get: vi.fn(),
  listAvailableAiModels: vi.fn(),
  getAiProviderKeyStatus: vi.fn(),
  updateAiModelSelection: vi.fn(),
}));

vi.mock("@/lib/Desktop", () => ({ getDesktopApi: () => ({ settings: bridge }) }));

const settings: DesktopSettings = {
  general: { minimizeToTray: true },
  recordingsDirectory: "/recordings",
  guideInstructions: "",
  localVisionModel: "first",
  aiModelSelections: {
    visual: { source: "local", modelId: "first", modelName: "First" },
    text: { source: "local", modelId: "writer", modelName: "Writer" },
  },
};

const nextSelection = { source: "local", modelId: "second", modelName: "Second" } as const;

beforeEach(() => {
  vi.resetAllMocks();
  bridge.get.mockResolvedValue(settings);
  bridge.listAvailableAiModels.mockResolvedValue({
    api: [],
    local: [],
    ollama: { status: "unavailable", endpoint: "" },
  });
  bridge.getAiProviderKeyStatus.mockResolvedValue({
    anthropic: false,
    openai: false,
    google: false,
    openrouter: false,
  });
});
afterEach(cleanup);

it("uses the same loading path for initial discovery and explicit refresh", async () => {
  const { result } = renderHook(() => useAiModels());

  await act(async () => {});
  bridge.get.mockResolvedValue({
    ...settings,
    aiModelSelections: { ...settings.aiModelSelections, text: nextSelection },
  });
  await act(() => result.current.refreshModels());

  expect(bridge.listAvailableAiModels).toHaveBeenCalledTimes(2);
  expect(result.current.selections.text).toEqual(nextSelection);
  expect(result.current.selections.visual).toEqual(settings.aiModelSelections.visual);
  expect(result.current.isLoading).toBe(false);
});

it("does not let an older catalog response replace a newly saved selection", async () => {
  const pending = Promise.withResolvers<DesktopSettings>();

  bridge.get.mockReturnValue(pending.promise);
  bridge.updateAiModelSelection.mockResolvedValue({
    ...settings,
    aiModelSelections: { ...settings.aiModelSelections, text: nextSelection },
  });
  const { result } = renderHook(() => useAiModels());

  await act(() => result.current.selectModel("text", nextSelection));
  await act(async () => {
    pending.resolve(settings);
  });

  expect(result.current.selections.text).toEqual(nextSelection);
  expect(result.current.isLoading).toBe(false);
});

it("reports a failed selection without overwriting the previously configured model", async () => {
  bridge.updateAiModelSelection.mockRejectedValue(new Error("Model unavailable"));
  const { result } = renderHook(() => useAiModels());

  await act(async () => {});
  await act(async () => {
    expect(await result.current.selectModel("text", nextSelection)).toBe(false);
  });

  expect(result.current.selections).toEqual(settings.aiModelSelections);
  expect(result.current.error).toBe("Model unavailable");
  expect(result.current.isSaving).toBe(false);
});

it("serves discovery and selection from an injected catalog provider", async () => {
  const catalog = {
    loadCatalog: vi.fn().mockResolvedValue({
      selections: { visual: nextSelection, text: settings.aiModelSelections.text },
      models: {
        api: [],
        local: [],
        ollama: { status: "running", endpoint: "http://ollama:11434" },
      },
      keyStatus: { anthropic: false, openai: false, google: false, openrouter: true },
    }),
    saveSelection: vi.fn().mockResolvedValue(nextSelection),
    openKeySettings: vi.fn().mockResolvedValue(undefined),
  };

  const { result } = renderHook(() => useAiModels(catalog));

  await act(async () => {});

  expect(result.current.selections.visual).toEqual(nextSelection);
  expect(result.current.keyStatus.openrouter).toBe(true);
  expect(bridge.listAvailableAiModels).not.toHaveBeenCalled();

  await act(() => result.current.openKeySettings());

  expect(catalog.openKeySettings).toHaveBeenCalled();
});

it("saves each role without replacing the other selection", async () => {
  const { result } = renderHook(() => useAiModels());

  await act(async () => {});
  bridge.updateAiModelSelection.mockResolvedValue({
    ...settings,
    aiModelSelections: { ...settings.aiModelSelections, text: nextSelection },
  });
  await act(() => result.current.selectModel("text", nextSelection));

  expect(bridge.updateAiModelSelection).toHaveBeenLastCalledWith({
    purpose: "text",
    selection: nextSelection,
  });
  expect(result.current.selections).toEqual({
    visual: settings.aiModelSelections.visual,
    text: nextSelection,
  });

  const visualSelection = { source: "local", modelId: "visual", modelName: "Visual" } as const;

  bridge.updateAiModelSelection.mockResolvedValue({
    ...settings,
    aiModelSelections: { visual: visualSelection, text: nextSelection },
  });
  await act(() => result.current.selectModel("visual", visualSelection));

  expect(result.current.selections).toEqual({ visual: visualSelection, text: nextSelection });
});

it("keeps both current selections when an older refresh finishes after a save", async () => {
  const pending = Promise.withResolvers<DesktopSettings>();
  const { result } = renderHook(() => useAiModels());

  await act(async () => {});
  bridge.get.mockReturnValue(pending.promise);
  let refresh: Promise<unknown>;

  act(() => {
    refresh = result.current.refreshModels();
  });
  bridge.updateAiModelSelection.mockResolvedValue({
    ...settings,
    aiModelSelections: { ...settings.aiModelSelections, text: nextSelection },
  });
  await act(() => result.current.selectModel("text", nextSelection));
  await act(async () => {
    pending.resolve(settings);
    await refresh;
  });

  expect(result.current.selections).toEqual({
    visual: settings.aiModelSelections.visual,
    text: nextSelection,
  });
});
