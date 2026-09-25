// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AiProviderKeyStatus, DesktopSettings } from "@path/shared";
import { useSettingsEditor } from "../src/hooks/useSettingsEditor";

const bridge = vi.hoisted(() => ({
  get: vi.fn(),
  getAiProviderKeyStatus: vi.fn(),
  getInfo: vi.fn(),
  updateGeneral: vi.fn(),
  setAiProviderKey: vi.fn(),
  removeAiProviderKey: vi.fn(),
}));

const translate = vi.hoisted(() => (key: string) => key);

vi.mock("next-intl", () => ({ useTranslations: () => translate }));
vi.mock("@/lib/Desktop", () => ({ getDesktopApi: () => ({ settings: bridge, app: bridge }) }));

const settings: DesktopSettings = {
  general: { minimizeToTray: true },
  timelineImports: { maxFileSizeMb: 10 },
  recordingsDirectory: "/recordings",
  aiModelSelections: {
    visual: { source: "local", modelId: "vision", modelName: "Vision" },
    text: { source: "local", modelId: "vision", modelName: "Vision" },
  },
};

beforeEach(() => {
  vi.resetAllMocks();
  bridge.get.mockResolvedValue(settings);
  bridge.getAiProviderKeyStatus.mockResolvedValue({
    anthropic: false,
    openai: false,
    google: false,
    openrouter: false,
  });
  bridge.getInfo.mockResolvedValue({ version: "0.1.0" });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function loadEditor() {
  const rendered = renderHook(() => useSettingsEditor());

  await act(async () => {});

  expect(rendered.result.current.isLoading).toBe(false);

  return rendered;
}

it("serializes settings saves before React has rendered the busy state", async () => {
  const pending = Promise.withResolvers<DesktopSettings>();

  bridge.updateGeneral.mockReturnValue(pending.promise);
  const { result } = await loadEditor();
  let firstSave: Promise<void>;

  act(() => {
    firstSave = result.current.updateGeneral({ minimizeToTray: false });
    void result.current.updateGeneral({ minimizeToTray: true });
  });

  expect(bridge.updateGeneral).toHaveBeenCalledTimes(1);

  await act(async () => {
    pending.resolve({ ...settings, general: { minimizeToTray: false } });
    await firstSave;
  });

  expect(result.current.settings?.general.minimizeToTray).toBe(false);
  expect(result.current.isBusy).toBe(false);
});

it("does not clear a different provider's draft when an earlier key save completes", async () => {
  const pending = Promise.withResolvers<AiProviderKeyStatus>();

  bridge.setAiProviderKey.mockReturnValue(pending.promise);
  const { result } = await loadEditor();

  act(() => result.current.toggleKeyEditor("openai"));
  act(() => result.current.changeKeyDraft("first-test-value"));
  let save: Promise<void>;

  act(() => {
    save = result.current.saveKey();
  });
  act(() => result.current.toggleKeyEditor("google"));
  act(() => result.current.changeKeyDraft("second-test-value"));

  await act(async () => {
    pending.resolve({ anthropic: false, openai: true, google: false, openrouter: false });
    await save;
  });

  expect(result.current.keyEditor).toEqual({ provider: "google", draft: "second-test-value" });
  expect(result.current.keyStatus.openai).toBe(true);
});

it("preserves a newly opened replacement draft when an earlier key removal completes", async () => {
  const pending = Promise.withResolvers<AiProviderKeyStatus>();

  bridge.removeAiProviderKey.mockReturnValue(pending.promise);
  bridge.getAiProviderKeyStatus.mockResolvedValue({
    anthropic: false,
    openai: true,
    google: false,
    openrouter: false,
  });
  const { result } = await loadEditor();
  let removal: Promise<void>;

  act(() => {
    removal = result.current.removeKey("openai");
  });
  act(() => result.current.toggleKeyEditor("openai"));
  act(() => result.current.changeKeyDraft("replacement-test-value"));

  await act(async () => {
    pending.resolve({ anthropic: false, openai: false, google: false, openrouter: false });
    await removal;
  });

  expect(result.current.keyEditor).toEqual({ provider: "openai", draft: "replacement-test-value" });
  expect(result.current.keyStatus.openai).toBe(false);
});

it("preserves a reopened editor even when its provider and draft match an earlier save", async () => {
  const pending = Promise.withResolvers<AiProviderKeyStatus>();

  bridge.setAiProviderKey.mockReturnValue(pending.promise);
  const { result } = await loadEditor();

  act(() => result.current.toggleKeyEditor("openai"));
  act(() => result.current.changeKeyDraft("same-test-value"));
  let save: Promise<void>;

  act(() => {
    save = result.current.saveKey();
  });

  // Equal draft text is not the same editing session after closing and reopening the field.
  act(() => result.current.toggleKeyEditor("openai"));
  act(() => result.current.toggleKeyEditor("openai"));
  act(() => result.current.changeKeyDraft("same-test-value"));

  await act(async () => {
    pending.resolve({ anthropic: false, openai: true, google: false, openrouter: false });
    await save;
  });

  expect(result.current.keyEditor).toEqual({ provider: "openai", draft: "same-test-value" });
});

it("closes the unchanged editor after its key is saved", async () => {
  bridge.setAiProviderKey.mockResolvedValue({
    anthropic: false,
    openai: true,
    google: false,
    openrouter: false,
  });
  const { result } = await loadEditor();

  act(() => result.current.toggleKeyEditor("openai"));
  act(() => result.current.changeKeyDraft("  test-value  "));
  await act(() => result.current.saveKey());

  expect(bridge.setAiProviderKey).toHaveBeenCalledWith({ provider: "openai", key: "test-value" });
  expect(result.current.keyEditor).toEqual({ provider: null, draft: "" });
  expect(result.current.keyStatus.openai).toBe(true);
});

it("closes an unchanged matching editor after removing its key", async () => {
  bridge.removeAiProviderKey.mockResolvedValue({
    anthropic: false,
    openai: false,
    google: false,
    openrouter: false,
  });
  const { result } = await loadEditor();

  act(() => result.current.toggleKeyEditor("openai"));
  await act(() => result.current.removeKey("openai"));

  expect(result.current.keyEditor).toEqual({ provider: null, draft: "" });
});

it("preserves the original settings and surfaces a failed save", async () => {
  bridge.updateGeneral.mockRejectedValue(new Error("Could not save"));
  const { result } = await loadEditor();

  await act(() => result.current.updateGeneral({ minimizeToTray: false }));

  expect(result.current.settings).toEqual(settings);
  expect(result.current.error).toBe("Could not save");
  expect(result.current.isBusy).toBe(false);
});

it("replaces success timers and clears them when the settings view unmounts", async () => {
  vi.useFakeTimers();
  bridge.updateGeneral.mockResolvedValue(settings);
  const { result, unmount } = await loadEditor();

  await act(() => result.current.updateGeneral({ minimizeToTray: true }));
  act(() => vi.advanceTimersByTime(2_000));
  await act(() => result.current.updateGeneral({ minimizeToTray: true }));
  act(() => vi.advanceTimersByTime(1_000));

  expect(result.current.notice).toBe("saved");
  expect(vi.getTimerCount()).toBe(1);

  unmount();

  expect(vi.getTimerCount()).toBe(0);
});

it("ignores a save response after the view has closed", async () => {
  vi.useFakeTimers();
  const pending = Promise.withResolvers<DesktopSettings>();

  bridge.updateGeneral.mockReturnValue(pending.promise);
  const { result, unmount } = await loadEditor();
  let save: Promise<void>;

  act(() => {
    save = result.current.updateGeneral({ minimizeToTray: false });
  });
  unmount();
  await act(async () => {
    pending.resolve(settings);
    await save;
  });

  expect(vi.getTimerCount()).toBe(0);
});
