import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AiModelSelection } from "@path/shared";
import { DesktopSettingsService } from "../src/settings/DesktopSettingsService";

vi.mock("electron", () => ({ app: { setLoginItemSettings: vi.fn() } }));

const localSelection: AiModelSelection = {
  source: "local",
  modelId: "local-vision:latest",
  modelName: "Local vision",
};

const apiSelection: AiModelSelection = {
  source: "api",
  provider: "openrouter",
  modelId: "provider/text-model",
  modelName: "Text model",
};

function createSettings(stored?: unknown) {
  const values = new Map<string, unknown>([["desktop-settings", structuredClone(stored)]]);
  const repository = {
    get: vi.fn(async (key: string) => structuredClone(values.get(key))),
    set: vi.fn(async (key: string, value: unknown) => {
      values.set(key, structuredClone(value));
    }),
  };

  const assets = { addAllowedRoot: vi.fn(), setRoot: vi.fn().mockResolvedValue(undefined) };
  const settings = new DesktopSettingsService(repository as never, assets as never, "recordings");

  return { settings, repository, assets };
}

describe("DesktopSettingsService AI models", () => {
  it("starts both roles with the existing default model", async () => {
    const { settings } = createSettings();

    await settings.initialize();

    expect(settings.get().aiModelSelections).toEqual({
      visual: {
        source: "local",
        modelId: "llama3.2-vision:latest",
        modelName: "llama3.2-vision:latest",
      },
      text: {
        source: "local",
        modelId: "llama3.2-vision:latest",
        modelName: "llama3.2-vision:latest",
      },
    });
  });

  it.each([localSelection, apiSelection])(
    "migrates a legacy $source selection to both roles without changing the provider",
    async (selection) => {
      const { settings } = createSettings({ aiModelSelection: selection });

      await settings.initialize();

      expect(settings.get().aiModelSelections).toEqual({ visual: selection, text: selection });
    },
  );

  it("falls back to the legacy local model when no valid selection was stored", async () => {
    const { settings } = createSettings({ localVisionModel: " custom-local:latest " });

    await settings.initialize();

    const selection = {
      source: "local",
      modelId: "custom-local:latest",
      modelName: "custom-local:latest",
    };

    expect(settings.get().aiModelSelections).toEqual({ visual: selection, text: selection });
    expect(settings.get().localVisionModel).toBe("custom-local:latest");
  });

  it.each([undefined, { ...apiSelection, provider: "unknown" }])(
    "retains valid new roles and migrates missing or malformed roles independently: %j",
    async (textSelection) => {
      const { settings } = createSettings({
        aiModelSelection: apiSelection,
        aiModelSelections: { visual: localSelection, text: textSelection },
        general: { minimizeToTray: false },
        guideInstructions: "Existing instructions",
        recordingsDirectory: "custom-recordings",
      });

      await settings.initialize();

      expect(settings.get()).toMatchObject({
        aiModelSelections: { visual: localSelection, text: apiSelection },
        general: { minimizeToTray: false },
        guideInstructions: "Existing instructions",
        recordingsDirectory: resolve("custom-recordings"),
      });
    },
  );

  it.each([
    null,
    [],
    { source: "local", modelId: "", modelName: "Invalid" },
    { source: "local", modelId: "   ", modelName: "Invalid" },
    { source: "api", provider: "unknown", modelId: "model", modelName: "Invalid" },
    { ...localSelection, unexpected: true },
  ])("ignores malformed persisted selections: %j", async (selection) => {
    const { settings } = createSettings({
      aiModelSelection: selection,
      aiModelSelections: { visual: selection, text: selection },
      localVisionModel: "legacy-model",
    });

    await settings.initialize();

    expect(settings.get().aiModelSelections.visual.modelId).toBe("legacy-model");
    expect(settings.get().aiModelSelections.text.modelId).toBe("legacy-model");
  });

  it("uses defaults for an invalid legacy local model", async () => {
    const { settings } = createSettings({ localVisionModel: "   " });

    await settings.initialize();

    expect(settings.get().aiModelSelections.visual.modelId).toBe("llama3.2-vision:latest");
    expect(settings.get().aiModelSelections.text.modelId).toBe("llama3.2-vision:latest");
  });

  it("saves independent selections and preserves them after reload", async () => {
    const { settings, repository, assets } = createSettings();

    await settings.initialize();
    await settings.updateAiModelSelection("visual", localSelection);
    await settings.updateAiModelSelection("text", apiSelection);

    const reloaded = new DesktopSettingsService(repository as never, assets as never, "recordings");

    await reloaded.initialize();

    expect(reloaded.get().aiModelSelections).toEqual({
      visual: localSelection,
      text: apiSelection,
    });
    expect(reloaded.get().localVisionModel).toBe(localSelection.modelId);
  });

  it("keeps legacy local updates scoped to visual and text updates out of the legacy field", async () => {
    const { settings } = createSettings({ aiModelSelection: apiSelection });

    await settings.initialize();
    await settings.updateLocalVisionModel("new-vision");

    expect(settings.get().aiModelSelections).toEqual({
      visual: { source: "local", modelId: "new-vision", modelName: "new-vision" },
      text: apiSelection,
    });

    await settings.updateAiModelSelection("text", localSelection);

    expect(settings.get().localVisionModel).toBe("new-vision");
    expect(settings.get().aiModelSelections.visual.modelId).toBe("new-vision");
  });

  it("returns snapshots that cannot change either role or their persisted selection", async () => {
    const { settings } = createSettings({ aiModelSelection: localSelection });

    await settings.initialize();

    const snapshot = settings.get();

    snapshot.aiModelSelections.visual.modelId = "changed-visual";
    snapshot.aiModelSelections.text.modelId = "changed-text";

    expect(settings.get().aiModelSelections).toEqual({
      visual: localSelection,
      text: localSelection,
    });

    const result = await settings.updateAiModelSelection("text", apiSelection);

    result.aiModelSelections.text.modelId = "changed-result";
    expect(settings.get().aiModelSelections.text).toEqual(apiSelection);
  });

  it("keeps the current choice after a save failure and accepts a later selection", async () => {
    const { settings, repository } = createSettings({ aiModelSelection: apiSelection });

    await settings.initialize();

    const before = settings.get();

    repository.set.mockRejectedValueOnce(new Error("Storage unavailable"));

    await expect(settings.updateAiModelSelection("visual", localSelection)).rejects.toThrow(
      "Storage unavailable",
    );
    expect(settings.get()).toEqual(before);

    await settings.updateAiModelSelection("text", localSelection);

    expect(settings.get().aiModelSelections).toEqual({
      visual: apiSelection,
      text: localSelection,
    });
  });

  it("serializes overlapping role saves and exposes only persisted choices", async () => {
    const { settings, repository, assets } = createSettings();

    await settings.initialize();

    const before = settings.get();
    const save = repository.set.getMockImplementation()!;
    let finishSave!: () => void;
    const pendingSave = new Promise<void>((resolveSave) => {
      finishSave = resolveSave;
    });

    repository.set.mockImplementationOnce(async (key, value) => {
      await pendingSave;
      await save(key, value);
    });

    const visualUpdate = settings.updateAiModelSelection("visual", localSelection);
    const textUpdate = settings.updateAiModelSelection("text", apiSelection);

    await Promise.resolve();

    expect(repository.set).toHaveBeenCalledTimes(1);
    expect(settings.get()).toEqual(before);

    finishSave();
    await Promise.all([visualUpdate, textUpdate]);

    const reloaded = new DesktopSettingsService(repository as never, assets as never, "recordings");

    await reloaded.initialize();

    expect(reloaded.get().aiModelSelections).toEqual({
      visual: localSelection,
      text: apiSelection,
    });
  });

  it("preserves general changes and the model choice when settings saves overlap", async () => {
    const { settings, repository, assets } = createSettings();

    await settings.initialize();

    const save = repository.set.getMockImplementation()!;
    let finishSave!: () => void;
    const pendingSave = new Promise<void>((resolveSave) => {
      finishSave = resolveSave;
    });

    repository.set.mockImplementationOnce(async (key, value) => {
      await pendingSave;
      await save(key, value);
    });

    const modelUpdate = settings.updateAiModelSelection("text", apiSelection);

    await Promise.resolve();

    const generalUpdate = settings.updateGeneral({ minimizeToTray: false });

    await Promise.resolve();

    expect(repository.set).toHaveBeenCalledTimes(1);

    finishSave();
    await Promise.all([modelUpdate, generalUpdate]);

    const reloaded = new DesktopSettingsService(repository as never, assets as never, "recordings");

    await reloaded.initialize();

    expect(reloaded.get().general.minimizeToTray).toBe(false);
    expect(reloaded.get().aiModelSelections.text).toEqual(apiSelection);
    expect(settings.get().general.minimizeToTray).toBe(false);
  });
});
