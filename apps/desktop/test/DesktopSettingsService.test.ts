import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiModelSelection } from "@path/shared";
import { DesktopSettingsService } from "../src/settings/DesktopSettingsService";
import { ManagedRecordingAssets } from "../src/storage/ManagedRecordingAssets";
import { openInProcessDatabase, type InProcessDatabase } from "./InProcessDatabase";

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

const databases: InProcessDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function openDatabase(): InProcessDatabase {
  const database = openInProcessDatabase();

  databases.push(database);

  return database;
}

/** A fresh service over the same stored data, as after an app restart. */
function createSettings(database: InProcessDatabase) {
  const assets = new ManagedRecordingAssets();
  const diagnostics = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const settings = new DesktopSettingsService(
    database.repositories,
    assets,
    join(database.directory, "recordings"),
    diagnostics,
  );

  return { settings, assets, diagnostics };
}

describe("DesktopSettingsService", () => {
  it("starts from defaults on first launch and registers the default recordings root", async () => {
    const database = openDatabase();
    const { settings, assets } = createSettings(database);

    await settings.initialize();

    expect(settings.get()).toEqual({
      general: { minimizeToTray: true },
      timelineImports: { maxFileSizeMb: 10 },
      recordingsDirectory: resolve(database.directory, "recordings"),
      aiModelSelections: {
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
      },
    });
    expect(assets.currentRoot.path).toBe(resolve(database.directory, "recordings"));
    await expect(database.repositories.appSettings.get("desktop-settings")).resolves.toBeNull();
  });

  it("persists every change and restores it after a restart", async () => {
    const database = openDatabase();
    const { settings } = createSettings(database);

    await settings.initialize();
    await settings.updateAiModelSelection("visual", localSelection);
    await settings.updateAiModelSelection("text", apiSelection);
    await settings.updateGeneral({ minimizeToTray: false });
    await settings.updateTimelineImports({ maxFileSizeMb: 25 });

    const { settings: reloaded } = createSettings(database);

    await reloaded.initialize();

    expect(reloaded.get()).toMatchObject({
      general: { minimizeToTray: false },
      timelineImports: { maxFileSizeMb: 25 },
      aiModelSelections: { visual: localSelection, text: apiSelection },
    });
  });

  it("keeps earlier recording roots managed after the location changes", async () => {
    const database = openDatabase();
    const { settings, assets } = createSettings(database);
    const moved = join(database.directory, "moved");

    await settings.initialize();

    const firstRoot = assets.currentRoot;

    await settings.updateRecordingsDirectory(moved);

    expect(settings.get().recordingsDirectory).toBe(resolve(moved));
    expect(assets.currentRoot.path).toBe(resolve(moved));
    expect(assets.isManagedFile(join(firstRoot.path, "recording", "recording.mp4"))).toBe(true);

    const { settings: reloaded, assets: reloadedAssets } = createSettings(database);

    await reloaded.initialize();

    expect(reloadedAssets.currentRoot.path).toBe(resolve(moved));
    expect(reloadedAssets.isManagedFile(join(firstRoot.path, "recording", "a.png"))).toBe(true);
    await expect(database.repositories.storageRoots.list()).resolves.toHaveLength(2);
  });

  it("returns snapshots that cannot change the stored settings", async () => {
    const database = openDatabase();
    const { settings } = createSettings(database);

    await settings.initialize();

    const snapshot = settings.get();

    snapshot.aiModelSelections.visual.modelId = "changed-visual";
    expect(settings.get().aiModelSelections.visual.modelId).toBe("llama3.2-vision:latest");

    const result = await settings.updateAiModelSelection("text", apiSelection);

    result.aiModelSelections.text.modelId = "changed-result";
    expect(settings.get().aiModelSelections.text).toEqual(apiSelection);
  });

  it("keeps the current choice after a failed write and accepts a later change", async () => {
    const database = openDatabase();
    const { settings } = createSettings(database);

    await settings.initialize();

    const before = settings.get();

    vi.spyOn(database.repositories.appSettings, "set").mockRejectedValueOnce(
      new Error("Storage unavailable"),
    );

    await expect(settings.updateAiModelSelection("visual", localSelection)).rejects.toThrow(
      "Storage unavailable",
    );
    expect(settings.get()).toEqual(before);

    await settings.updateAiModelSelection("text", localSelection);

    expect(settings.get().aiModelSelections.text).toEqual(localSelection);
  });

  it("serializes overlapping changes so none is lost", async () => {
    const database = openDatabase();
    const { settings } = createSettings(database);

    await settings.initialize();

    const updates = [
      settings.updateAiModelSelection("visual", localSelection),
      settings.updateAiModelSelection("text", apiSelection),
      settings.updateGeneral({ minimizeToTray: false }),
    ];

    await Promise.all(updates);

    const { settings: reloaded } = createSettings(database);

    await reloaded.initialize();

    expect(reloaded.get()).toMatchObject({
      general: { minimizeToTray: false },
      aiModelSelections: { visual: localSelection, text: apiSelection },
    });
  });

  it.each([
    { timelineImports: { maxFileSizeMb: 0 } },
    { timelineImports: { maxFileSizeMb: 2.5 } },
    { aiModelSelections: { visual: { source: "local", modelId: "", modelName: "x" } } },
    "not an object",
  ])("uses defaults for invalid stored settings without overwriting them: %j", async (patch) => {
    const database = openDatabase();
    const { settings: first } = createSettings(database);

    await first.initialize();

    const stored =
      typeof patch === "string"
        ? patch
        : { ...first.get(), general: { minimizeToTray: false }, ...patch };

    await database.repositories.appSettings.set("desktop-settings", stored);

    const { settings, diagnostics } = createSettings(database);

    await settings.initialize();

    expect(settings.get().general.minimizeToTray).toBe(true);
    expect(settings.get().timelineImports).toEqual({ maxFileSizeMb: 10 });
    expect(diagnostics.warn).toHaveBeenCalledOnce();
    await expect(database.repositories.appSettings.get("desktop-settings")).resolves.toEqual(
      stored,
    );
  });
});
