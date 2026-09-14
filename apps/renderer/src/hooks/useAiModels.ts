import { useCallback, useEffect, useReducer, useRef } from "react";
import type { AiModelSelection, AiProviderKeyStatus, AvailableAiModels } from "@path/shared";
import { getDesktopApi } from "@/lib/Desktop";

interface ModelCatalog {
  models: AvailableAiModels;
  keyStatus: AiProviderKeyStatus;
  selection: AiModelSelection | null;
}

interface ModelState extends ModelCatalog {
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
}

type ModelAction =
  | { type: "refresh-started" }
  | { type: "catalog-loaded"; catalog: ModelCatalog }
  | { type: "selection-started" }
  | { type: "selection-saved"; selection: AiModelSelection }
  | { type: "failed"; message: string };

const initialState: ModelState = {
  models: { api: [], local: [] },
  keyStatus: { anthropic: false, openai: false, google: false },
  selection: null,
  isLoading: true,
  isSaving: false,
  error: null,
};

// Publish catalog content and loading/saving flags as one consistent chooser state.
function reduceModels(state: ModelState, action: ModelAction): ModelState {
  switch (action.type) {
    case "refresh-started":
      return { ...state, isLoading: true, error: null };

    case "catalog-loaded":
      return { ...state, ...action.catalog, isLoading: false, error: null };

    case "selection-started":
      return { ...state, isSaving: true, error: null };

    case "selection-saved":
      return { ...state, selection: action.selection, isLoading: false, isSaving: false };

    case "failed":
      return { ...state, error: action.message, isLoading: false, isSaving: false };
  }
}

interface AiModels extends ModelState {
  refreshModels(): Promise<AiProviderKeyStatus | null>;
  selectModel(selection: AiModelSelection): Promise<boolean>;
}

/** Owns model discovery and selection, with newer requests superseding stale completions. */
export function useAiModels(): AiModels {
  const [state, dispatch] = useReducer(reduceModels, initialState);
  const requestIdRef = useRef(0);
  const isSavingRef = useRef(false);

  const loadModels = useCallback(async (): Promise<AiProviderKeyStatus | null> => {
    const requestId = ++requestIdRef.current;

    try {
      const catalog = await loadModelCatalog();

      if (requestId !== requestIdRef.current) return null;

      dispatch({ type: "catalog-loaded", catalog });

      return catalog.keyStatus;
    } catch (error) {
      if (requestId === requestIdRef.current) {
        dispatch({ type: "failed", message: errorMessage(error) });
      }

      return null;
    }
  }, []);

  useEffect(() => {
    void loadModels();

    return () => {
      requestIdRef.current += 1;
    };
  }, [loadModels]);

  async function refreshModels(): Promise<AiProviderKeyStatus | null> {
    if (isSavingRef.current) return null;

    dispatch({ type: "refresh-started" });

    return loadModels();
  }

  async function selectModel(selection: AiModelSelection): Promise<boolean> {
    const desktop = getDesktopApi();

    if (!desktop || isSavingRef.current) return false;

    isSavingRef.current = true;
    const requestId = ++requestIdRef.current;

    dispatch({ type: "selection-started" });

    try {
      const settings = await desktop.settings.updateAiModelSelection(selection);

      if (requestId !== requestIdRef.current) return false;

      dispatch({ type: "selection-saved", selection: settings.aiModelSelection });

      return true;
    } catch (error) {
      if (requestId === requestIdRef.current) {
        dispatch({ type: "failed", message: errorMessage(error) });
      }

      return false;
    } finally {
      isSavingRef.current = false;
    }
  }

  return { ...state, refreshModels, selectModel };
}

async function loadModelCatalog(): Promise<ModelCatalog> {
  const desktop = getDesktopApi();

  if (!desktop) {
    return { models: initialState.models, keyStatus: initialState.keyStatus, selection: null };
  }

  const [settings, models, keyStatus] = await Promise.all([
    desktop.settings.get(),
    desktop.settings.listAvailableAiModels(),
    desktop.settings.getAiProviderKeyStatus(),
  ]);

  return { selection: settings.aiModelSelection, models, keyStatus };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
