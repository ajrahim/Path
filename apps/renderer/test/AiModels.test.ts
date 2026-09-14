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
  aiModelSelection: { source: "local", modelId: "first", modelName: "First" },
};

const nextSelection = { source: "local", modelId: "second", modelName: "Second" } as const;

beforeEach(() => {
  vi.resetAllMocks();
  bridge.get.mockResolvedValue(settings);
  bridge.listAvailableAiModels.mockResolvedValue({ api: [], local: [] });
  bridge.getAiProviderKeyStatus.mockResolvedValue({
    anthropic: false,
    openai: false,
    google: false,
  });
});
afterEach(cleanup);

it("uses the same loading path for initial discovery and explicit refresh", async () => {
  const { result } = renderHook(() => useAiModels());

  await act(async () => {});
  bridge.get.mockResolvedValue({ ...settings, aiModelSelection: nextSelection });
  await act(() => result.current.refreshModels());

  expect(bridge.listAvailableAiModels).toHaveBeenCalledTimes(2);
  expect(result.current.selection).toEqual(nextSelection);
  expect(result.current.isLoading).toBe(false);
});

it("does not let an older catalog response replace a newly saved selection", async () => {
  const pending = Promise.withResolvers<DesktopSettings>();

  bridge.get.mockReturnValue(pending.promise);
  bridge.updateAiModelSelection.mockResolvedValue({ ...settings, aiModelSelection: nextSelection });
  const { result } = renderHook(() => useAiModels());

  await act(() => result.current.selectModel(nextSelection));
  await act(async () => {
    pending.resolve(settings);
  });

  expect(result.current.selection).toEqual(nextSelection);
  expect(result.current.isLoading).toBe(false);
});

it("reports a failed selection without overwriting the previously configured model", async () => {
  bridge.updateAiModelSelection.mockRejectedValue(new Error("Model unavailable"));
  const { result } = renderHook(() => useAiModels());

  await act(async () => {});
  await act(async () => {
    expect(await result.current.selectModel(nextSelection)).toBe(false);
  });

  expect(result.current.selection).toEqual(settings.aiModelSelection);
  expect(result.current.error).toBe("Model unavailable");
  expect(result.current.isSaving).toBe(false);
});
