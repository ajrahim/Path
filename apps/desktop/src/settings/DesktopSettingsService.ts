import { app } from "electron";
import { resolve } from "node:path";
import type { AppSettingsRepository } from "@path/database";
import type { AiModelSelection, DesktopSettings, GeneralSettings } from "@path/shared";
import type { ManagedRecordingAssets } from "../storage/ManagedRecordingAssets";

const SETTINGS_KEY = "desktop-settings";
const RECORDING_ROOT_HISTORY_KEY = "recording-root-history";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export class DesktopSettingsService {
  private current: DesktopSettings;

  constructor(
    private readonly repository: AppSettingsRepository,
    private readonly assets: ManagedRecordingAssets,
    defaultRecordingsDirectory: string,
  ) {
    this.current = {
      general: { minimizeToTray: true },
      recordingsDirectory: resolve(defaultRecordingsDirectory),
      guideInstructions: "",
      localVisionModel: "llama3.2-vision:latest",
      aiModelSelection: {
        source: "local",
        modelId: "llama3.2-vision:latest",
        modelName: "llama3.2-vision:latest",
      },
    };
  }

  async initialize(): Promise<void> {
    const stored = await this.repository.get<unknown>(SETTINGS_KEY);

    // Fill fields absent from older profiles without replacing their valid persisted preferences.
    if (isRecord(stored)) {
      const general = isRecord(stored.general) ? stored.general : {};
      const storedSelection = isRecord(stored.aiModelSelection) ? stored.aiModelSelection : null;
      const localVisionModel =
        typeof stored.localVisionModel === "string" && stored.localVisionModel
          ? stored.localVisionModel
          : this.current.localVisionModel;

      this.current = {
        general: {
          minimizeToTray:
            typeof general.minimizeToTray === "boolean" ? general.minimizeToTray : true,
        },
        recordingsDirectory:
          typeof stored.recordingsDirectory === "string" && stored.recordingsDirectory
            ? resolve(stored.recordingsDirectory)
            : this.current.recordingsDirectory,
        guideInstructions:
          typeof stored.guideInstructions === "string" ? stored.guideInstructions : "",
        localVisionModel,
        aiModelSelection: parseAiModelSelection(storedSelection) ?? {
          source: "local",
          modelId: localVisionModel,
          modelName: localVisionModel,
        },
      };
    }

    const history = (await this.repository.get<unknown>(RECORDING_ROOT_HISTORY_KEY)) ?? [];

    if (Array.isArray(history)) {
      for (const directory of history) {
        if (typeof directory === "string" && directory) {
          this.assets.addAllowedRoot(directory);
        }
      }
    }

    await this.assets.setRoot(this.current.recordingsDirectory);
    this.disableLaunchAtLogin();
  }

  get(): DesktopSettings {
    // Callers receive snapshots so they cannot mutate the service's current settings by reference.
    return {
      general: { ...this.current.general },
      recordingsDirectory: this.current.recordingsDirectory,
      guideInstructions: this.current.guideInstructions,
      localVisionModel: this.current.localVisionModel,
      aiModelSelection: { ...this.current.aiModelSelection },
    };
  }

  async updateGeneral(general: GeneralSettings): Promise<DesktopSettings> {
    this.current.general = { ...general };
    await this.persist();

    return this.get();
  }

  async updateGuideInstructions(guideInstructions: string): Promise<DesktopSettings> {
    this.current.guideInstructions = guideInstructions;
    await this.persist();

    return this.get();
  }

  async updateLocalVisionModel(model: string): Promise<DesktopSettings> {
    this.current.localVisionModel = model;
    this.current.aiModelSelection = { source: "local", modelId: model, modelName: model };
    await this.persist();

    return this.get();
  }

  async updateAiModelSelection(selection: AiModelSelection): Promise<DesktopSettings> {
    this.current.aiModelSelection = { ...selection };
    if (selection.source === "local") {
      this.current.localVisionModel = selection.modelId;
    }

    await this.persist();

    return this.get();
  }

  async updateRecordingsDirectory(directory: string): Promise<DesktopSettings> {
    const nextDirectory = resolve(directory);
    const history = (await this.repository.get<unknown>(RECORDING_ROOT_HISTORY_KEY)) ?? [];
    const roots = Array.isArray(history)
      ? history.filter((root): root is string => typeof root === "string")
      : [];

    roots.push(this.current.recordingsDirectory, nextDirectory);
    const uniqueRoots = [...new Set(roots.map((root) => resolve(root)))];

    // Update the default for new recordings while retaining access to files in previous roots.
    await this.assets.setRoot(nextDirectory);
    this.current.recordingsDirectory = nextDirectory;
    await this.repository.set(RECORDING_ROOT_HISTORY_KEY, uniqueRoots);
    await this.persist();

    return this.get();
  }

  private async persist(): Promise<void> {
    await this.repository.set(SETTINGS_KEY, this.current);
  }

  private disableLaunchAtLogin(): void {
    if (!["darwin", "win32"].includes(process.platform)) return;
    app.setLoginItemSettings({ openAtLogin: false });
  }
}

function parseAiModelSelection(value: Record<string, unknown> | null): AiModelSelection | null {
  if (
    value?.source === "local" &&
    typeof value.modelId === "string" &&
    typeof value.modelName === "string"
  ) {
    return { source: "local", modelId: value.modelId, modelName: value.modelName };
  }

  if (
    value?.source === "api" &&
    ["anthropic", "openai", "google"].includes(String(value.provider)) &&
    typeof value.modelId === "string" &&
    typeof value.modelName === "string"
  ) {
    return {
      source: "api",
      provider: value.provider as "anthropic" | "openai" | "google",
      modelId: value.modelId,
      modelName: value.modelName,
    };
  }

  return null;
}
