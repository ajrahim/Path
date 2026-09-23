import { app } from "electron";
import { resolve } from "node:path";
import type { AppSettingsRepository } from "@path/database";
import { aiModelSelectionSchema } from "@path/shared";
import type {
  AiModelPurpose,
  AiModelSelection,
  DesktopSettings,
  GeneralSettings,
} from "@path/shared";
import type { ManagedRecordingAssets } from "../storage/ManagedRecordingAssets";

const SETTINGS_KEY = "desktop-settings";
const RECORDING_ROOT_HISTORY_KEY = "recording-root-history";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export class DesktopSettingsService {
  private current: DesktopSettings;
  private aiModelSelectionUpdate: Promise<void> = Promise.resolve();

  constructor(
    private readonly repository: AppSettingsRepository,
    private readonly assets: ManagedRecordingAssets,
    defaultRecordingsDirectory: string,
  ) {
    const defaultSelection: AiModelSelection = {
      source: "local",
      modelId: "llama3.2-vision:latest",
      modelName: "llama3.2-vision:latest",
    };

    this.current = {
      general: { minimizeToTray: true },
      recordingsDirectory: resolve(defaultRecordingsDirectory),
      guideInstructions: "",
      localVisionModel: "llama3.2-vision:latest",
      aiModelSelections: { visual: { ...defaultSelection }, text: { ...defaultSelection } },
    };
  }

  async initialize(): Promise<void> {
    const stored = await this.repository.get<unknown>(SETTINGS_KEY);

    // Fill fields absent from older profiles without replacing their valid persisted preferences.
    if (isRecord(stored)) {
      const general = isRecord(stored.general) ? stored.general : {};
      const storedSelections = isRecord(stored.aiModelSelections) ? stored.aiModelSelections : {};
      const localSelection =
        parseAiModelSelection({
          source: "local",
          modelId: stored.localVisionModel,
          modelName: stored.localVisionModel,
        }) ?? this.current.aiModelSelections.visual;

      const legacySelection = parseAiModelSelection(stored.aiModelSelection) ?? localSelection;
      const visualSelection = parseAiModelSelection(storedSelections.visual) ?? legacySelection;
      const textSelection = parseAiModelSelection(storedSelections.text) ?? legacySelection;

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
        localVisionModel:
          visualSelection.source === "local" ? visualSelection.modelId : localSelection.modelId,
        aiModelSelections: {
          visual: { ...visualSelection },
          text: { ...textSelection },
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
      aiModelSelections: {
        visual: { ...this.current.aiModelSelections.visual },
        text: { ...this.current.aiModelSelections.text },
      },
    };
  }

  async updateGeneral(general: GeneralSettings): Promise<DesktopSettings> {
    this.current.general = { ...general };
    await this.persist();

    return this.get();
  }

  /** @deprecated Generation uses the workspace instruction flows; retained for stored settings. */
  async updateGuideInstructions(guideInstructions: string): Promise<DesktopSettings> {
    this.current.guideInstructions = guideInstructions;
    await this.persist();

    return this.get();
  }

  async updateLocalVisionModel(model: string): Promise<DesktopSettings> {
    return this.updateAiModelSelection("visual", {
      source: "local",
      modelId: model,
      modelName: model,
    });
  }

  async updateAiModelSelection(
    purpose: AiModelPurpose,
    selection: AiModelSelection,
  ): Promise<DesktopSettings> {
    const nextSelection = { ...selection };
    const update = this.aiModelSelectionUpdate.then(async () => {
      const nextSettings = this.get();

      nextSettings.aiModelSelections[purpose] = nextSelection;
      if (purpose === "visual" && nextSelection.source === "local") {
        nextSettings.localVisionModel = nextSelection.modelId;
      }

      await this.repository.set(SETTINGS_KEY, nextSettings);
      this.current.aiModelSelections = nextSettings.aiModelSelections;
      this.current.localVisionModel = nextSettings.localVisionModel;

      return this.get();
    });

    // Keep later role changes available if an earlier save fails.
    this.aiModelSelectionUpdate = update.then(
      () => {},
      () => {},
    );

    return update;
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
    await this.aiModelSelectionUpdate;
    await this.repository.set(SETTINGS_KEY, this.current);
  }

  private disableLaunchAtLogin(): void {
    if (!["darwin", "win32"].includes(process.platform)) return;
    app.setLoginItemSettings({ openAtLogin: false });
  }
}

function parseAiModelSelection(value: unknown): AiModelSelection | null {
  const result = aiModelSelectionSchema.safeParse(value);

  return result.success ? result.data : null;
}
