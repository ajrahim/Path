import type {
  AiModelPurpose,
  AiModelSelection,
  AiProviderKeyStatus,
  AvailableAiModels,
} from "@path/shared";
import { getDesktopApi } from "./Desktop";

export interface ModelCatalogSnapshot {
  selections: Record<AiModelPurpose, AiModelSelection | null>;
  models: AvailableAiModels;
  keyStatus: AiProviderKeyStatus;
}

/**
 * Catalog source behind the model selector. The Electron app serves this over
 * IPC; a future library host provides its own discovery without touching the UI.
 */
export interface ModelCatalogProvider {
  loadCatalog(): Promise<ModelCatalogSnapshot>;
  saveSelection(purpose: AiModelPurpose, selection: AiModelSelection): Promise<AiModelSelection>;
  openKeySettings(): Promise<void>;
}

const emptyCatalog: AvailableAiModels = {
  api: [],
  local: [],
  ollama: { status: "unavailable", endpoint: "" },
};

const emptyKeyStatus: AiProviderKeyStatus = {
  anthropic: false,
  openai: false,
  google: false,
  openrouter: false,
};

export function createIpcModelCatalogProvider(): ModelCatalogProvider {
  return {
    async loadCatalog() {
      const desktop = getDesktopApi();

      if (!desktop) {
        return {
          selections: { visual: null, text: null },
          models: emptyCatalog,
          keyStatus: emptyKeyStatus,
        };
      }

      const [settings, models, keyStatus] = await Promise.all([
        desktop.settings.get(),
        desktop.settings.listAvailableAiModels(),
        desktop.settings.getAiProviderKeyStatus(),
      ]);

      return { selections: settings.aiModelSelections, models, keyStatus };
    },

    async saveSelection(purpose, selection) {
      const desktop = getDesktopApi();

      if (!desktop) throw new Error("AI models are only available in the desktop app.");

      const settings = await desktop.settings.updateAiModelSelection({ purpose, selection });

      return settings.aiModelSelections[purpose];
    },

    async openKeySettings() {
      await getDesktopApi()?.app.openSettings({ section: "keys" });
    },
  };
}
