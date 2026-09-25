import { resolve } from "node:path";
import {
  DEFAULT_TIMELINE_IMPORT_MAX_FILE_SIZE_MB,
  storedDesktopSettingsSchema,
  type AiModelPurpose,
  type AiModelSelection,
  type DesktopSettings,
  type GeneralSettings,
  type TimelineImportSettings,
} from "@path/shared";
import type { RemoteRepositories } from "../storage/DatabaseClient";
import type { Diagnostics } from "../storage/DiagnosticLog";
import type { ManagedRecordingAssets } from "../storage/ManagedRecordingAssets";

const SETTINGS_KEY = "desktop-settings";
const DEFAULT_MODEL_ID = "llama3.2-vision:latest";

/**
 * Owns desktop settings in SQLite. Changes are serialized and written before they take effect,
 * so a failed write never leaves memory ahead of storage.
 */
export class DesktopSettingsService {
  private current: DesktopSettings;
  private mutation: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly repositories: Pick<RemoteRepositories, "appSettings" | "storageRoots">,
    private readonly assets: Pick<ManagedRecordingAssets, "useRoots">,
    defaultRecordingsDirectory: string,
    private readonly diagnostics: Diagnostics,
  ) {
    const defaultSelection: AiModelSelection = {
      source: "local",
      modelId: DEFAULT_MODEL_ID,
      modelName: DEFAULT_MODEL_ID,
    };

    this.current = {
      general: { minimizeToTray: true },
      timelineImports: { maxFileSizeMb: DEFAULT_TIMELINE_IMPORT_MAX_FILE_SIZE_MB },
      recordingsDirectory: resolve(defaultRecordingsDirectory),
      aiModelSelections: { visual: { ...defaultSelection }, text: { ...defaultSelection } },
    };
  }

  async initialize(): Promise<void> {
    const stored = await this.repositories.appSettings.get(SETTINGS_KEY);

    if (stored !== null) {
      const parsed = storedDesktopSettingsSchema.safeParse(stored);

      // Invalid stored settings are left untouched on disk until the user changes a setting.
      if (parsed.success) {
        this.current = {
          ...parsed.data,
          recordingsDirectory: resolve(parsed.data.recordingsDirectory),
        };
      } else {
        this.diagnostics.warn("Stored desktop settings were invalid; defaults are in use");
      }
    }

    await this.applyRecordingsDirectory(this.current.recordingsDirectory);
  }

  get(): DesktopSettings {
    // Callers receive snapshots so they cannot mutate the service's current settings by reference.
    return structuredClone(this.current);
  }

  updateGeneral(general: GeneralSettings): Promise<DesktopSettings> {
    return this.commit((next) => {
      next.general = { ...general };
    });
  }

  updateTimelineImports(timelineImports: TimelineImportSettings): Promise<DesktopSettings> {
    return this.commit((next) => {
      next.timelineImports = { ...timelineImports };
    });
  }

  updateAiModelSelection(
    purpose: AiModelPurpose,
    selection: AiModelSelection,
  ): Promise<DesktopSettings> {
    return this.commit((next) => {
      next.aiModelSelections[purpose] = { ...selection };
    });
  }

  /** New recordings use the new directory; recordings in earlier roots stay registered. */
  updateRecordingsDirectory(directory: string): Promise<DesktopSettings> {
    const nextDirectory = resolve(directory);

    return this.serialize(async () => {
      const previousDirectory = this.current.recordingsDirectory;

      await this.applyRecordingsDirectory(nextDirectory);

      try {
        return await this.write({ ...this.get(), recordingsDirectory: nextDirectory });
      } catch (error) {
        await this.applyRecordingsDirectory(previousDirectory);

        throw error;
      }
    });
  }

  private commit(change: (next: DesktopSettings) => void): Promise<DesktopSettings> {
    return this.serialize(() => {
      const next = this.get();

      change(next);

      return this.write(next);
    });
  }

  private async write(next: DesktopSettings): Promise<DesktopSettings> {
    await this.repositories.appSettings.set(SETTINGS_KEY, next);
    this.current = next;

    return this.get();
  }

  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(action);

    // A failed change must not block later ones.
    this.mutation = result.catch(() => undefined);

    return result;
  }

  private async applyRecordingsDirectory(directory: string): Promise<void> {
    const current = await this.repositories.storageRoots.register(directory);
    const registered = await this.repositories.storageRoots.list();

    await this.assets.useRoots(current, registered);
  }
}
