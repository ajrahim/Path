import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { AiModelPurpose, AiModelSelection, AiProviderKeyStatus } from "@path/shared";
import {
  createIpcModelCatalogProvider,
  type ModelCatalogProvider,
  type ModelCatalogSnapshot,
} from "@/lib/ModelCatalog";

interface ModelState extends ModelCatalogSnapshot {
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
}

type ModelAction =
  | { type: "refresh-started" }
  | { type: "catalog-loaded"; catalog: ModelCatalogSnapshot }
  | { type: "selection-started" }
  | { type: "selection-saved"; purpose: AiModelPurpose; selection: AiModelSelection }
  | { type: "failed"; message: string };

const initialState: ModelState = {
  models: { api: [], local: [], ollama: { status: "unavailable", endpoint: "" } },
  keyStatus: { anthropic: false, openai: false, google: false, openrouter: false },
  selections: { visual: null, text: null },
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
      return {
        ...state,
        selections: { ...state.selections, [action.purpose]: action.selection },
        isLoading: false,
        isSaving: false,
      };

    case "failed":
      return { ...state, error: action.message, isLoading: false, isSaving: false };
  }
}

interface AiModels extends ModelState {
  refreshModels(): Promise<AiProviderKeyStatus | null>;
  selectModel(purpose: AiModelPurpose, selection: AiModelSelection): Promise<boolean>;
  openKeySettings(): Promise<void>;
}

/** Owns model discovery and selection, with newer requests superseding stale completions. */
export function useAiModels(provider?: ModelCatalogProvider): AiModels {
  const [state, dispatch] = useReducer(reduceModels, initialState);
  const [catalog] = useState(() => provider ?? createIpcModelCatalogProvider());
  const requestIdRef = useRef(0);
  const isSavingRef = useRef(false);

  const loadModels = useCallback(async (): Promise<AiProviderKeyStatus | null> => {
    const requestId = ++requestIdRef.current;

    try {
      const snapshot = await catalog.loadCatalog();

      if (requestId !== requestIdRef.current) return null;

      dispatch({ type: "catalog-loaded", catalog: snapshot });

      return snapshot.keyStatus;
    } catch (error) {
      if (requestId === requestIdRef.current) {
        dispatch({ type: "failed", message: errorMessage(error) });
      }

      return null;
    }
  }, [catalog]);

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

  async function selectModel(
    purpose: AiModelPurpose,
    selection: AiModelSelection,
  ): Promise<boolean> {
    if (isSavingRef.current) return false;

    isSavingRef.current = true;
    const requestId = ++requestIdRef.current;

    dispatch({ type: "selection-started" });

    try {
      const saved = await catalog.saveSelection(purpose, selection);

      if (requestId !== requestIdRef.current) return false;

      dispatch({ type: "selection-saved", purpose, selection: saved });

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

  async function openKeySettings(): Promise<void> {
    await catalog.openKeySettings();
  }

  return { ...state, refreshModels, selectModel, openKeySettings };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
