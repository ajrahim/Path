import { useEffect, useReducer, useRef } from "react";
import { useTranslations } from "next-intl";
import type {
  AiProvider,
  AiProviderKeyStatus,
  DesktopSettings,
  GeneralSettings,
} from "@path/shared";
import { getDesktopApi } from "@/lib/Desktop";

const SETTINGS_NOTICE_MS = 3_000;

type SettingsOperation =
  "general" | "directory" | "open-directory" | `key-${AiProvider}` | `remove-${AiProvider}`;

interface KeyEditor {
  provider: AiProvider | null;
  draft: string;
}

interface SettingsEditorState {
  settings: DesktopSettings | null;
  keyStatus: AiProviderKeyStatus;
  version: string;
  keyEditor: KeyEditor;
  busy: "loading" | SettingsOperation | null;
  error: string | null;
  notice: { message: string; id: number } | null;
}

interface SettingsUpdate {
  settings?: DesktopSettings;
  keyStatus?: AiProviderKeyStatus;
  completedKeyEditor?: KeyEditor;
}

type SettingsAction =
  | { type: "loaded"; settings: DesktopSettings; keyStatus: AiProviderKeyStatus; version: string }
  | { type: "failed"; message: string }
  | { type: "mutation-started"; operation: SettingsOperation }
  | {
      type: "mutation-completed";
      update: SettingsUpdate | null;
      notice: SettingsEditorState["notice"];
    }
  | { type: "key-editor-toggled"; provider: AiProvider }
  | { type: "key-draft-changed"; draft: string }
  | { type: "notice-dismissed"; id: number };

const initialState: SettingsEditorState = {
  settings: null,
  keyStatus: { anthropic: false, openai: false, google: false, openrouter: false },
  version: "",
  keyEditor: { provider: null, draft: "" },
  busy: "loading",
  error: null,
  notice: null,
};

// Apply saved settings, pending operations, and notices together without discarding newer drafts.
function reduceSettings(state: SettingsEditorState, action: SettingsAction): SettingsEditorState {
  switch (action.type) {
    case "loaded":
      return {
        ...state,
        settings: action.settings,
        keyStatus: action.keyStatus,
        version: action.version,
        busy: null,
      };

    case "failed":
      return { ...state, busy: null, error: action.message, notice: null };

    case "mutation-started":
      return { ...state, busy: action.operation, error: null, notice: null };

    case "mutation-completed": {
      const update = action.update;
      // An edit or reopen creates a new editor object, even with identical text.
      // Only dismiss the unchanged editor that initiated the completed operation.
      const hasCompletedCurrentEditor = update?.completedKeyEditor === state.keyEditor;

      return {
        ...state,
        settings: update?.settings ?? state.settings,
        keyStatus: update?.keyStatus ?? state.keyStatus,
        keyEditor: hasCompletedCurrentEditor ? { provider: null, draft: "" } : state.keyEditor,
        busy: null,
        notice: action.notice,
      };
    }

    case "key-editor-toggled":
      return {
        ...state,
        keyEditor: {
          provider: state.keyEditor.provider === action.provider ? null : action.provider,
          draft: "",
        },
        error: null,
      };

    case "key-draft-changed":
      return { ...state, keyEditor: { ...state.keyEditor, draft: action.draft } };

    case "notice-dismissed":
      return state.notice?.id === action.id ? { ...state, notice: null } : state;
  }
}

interface SettingsEditor extends Omit<SettingsEditorState, "notice"> {
  notice: string | null;
  isLoading: boolean;
  isBusy: boolean;
  updateGeneral(general: GeneralSettings): Promise<void>;
  chooseDirectory(): Promise<void>;
  openDirectory(): Promise<void>;
  saveKey(): Promise<void>;
  removeKey(provider: AiProvider): Promise<void>;
  toggleKeyEditor(provider: AiProvider): void;
  changeKeyDraft(draft: string): void;
}

/** Owns settings drafts and serialized writes for one mounted settings window. */
export function useSettingsEditor(): SettingsEditor {
  const t = useTranslations("settings");
  const [state, dispatch] = useReducer(reduceSettings, initialState);
  const sessionRef = useRef(0);
  // The immediate lock also covers repeated events before React renders the busy state.
  const operationRef = useRef(false);
  const noticeIdRef = useRef(0);

  useEffect(() => {
    const sessionId = ++sessionRef.current;
    const desktop = getDesktopApi();

    operationRef.current = true;

    async function loadSettings(): Promise<void> {
      if (sessionId !== sessionRef.current) return;

      try {
        if (!desktop) throw new Error(t("desktopRequired"));

        const [settings, keyStatus, info] = await Promise.all([
          desktop.settings.get(),
          desktop.settings.getAiProviderKeyStatus(),
          desktop.app.getInfo(),
        ]);

        if (sessionId === sessionRef.current) {
          dispatch({ type: "loaded", settings, keyStatus, version: info.version });
        }
      } catch (error) {
        if (sessionId === sessionRef.current) {
          dispatch({ type: "failed", message: messageFromError(error, t("loadError")) });
        }
      } finally {
        if (sessionId === sessionRef.current) operationRef.current = false;
      }
    }

    void Promise.resolve().then(loadSettings);

    return () => {
      sessionRef.current += 1;
    };
  }, [t]);

  useEffect(() => {
    const notice = state.notice;

    if (!notice) return;

    const timer = window.setTimeout(
      () => dispatch({ type: "notice-dismissed", id: notice.id }),
      SETTINGS_NOTICE_MS,
    );

    return () => window.clearTimeout(timer);
  }, [state.notice]);

  async function mutate({
    operation,
    successMessage,
    failureMessage,
    run,
  }: {
    operation: SettingsOperation;
    successMessage?: string;
    failureMessage: string;
    run(): Promise<SettingsUpdate | null>;
  }): Promise<void> {
    if (operationRef.current) return;

    operationRef.current = true;
    const sessionId = sessionRef.current;

    dispatch({ type: "mutation-started", operation });

    try {
      const update = await run();

      if (sessionId !== sessionRef.current) return;

      const notice =
        update && successMessage ? { message: successMessage, id: ++noticeIdRef.current } : null;

      dispatch({ type: "mutation-completed", update, notice });
    } catch (error) {
      if (sessionId === sessionRef.current) {
        dispatch({ type: "failed", message: messageFromError(error, failureMessage) });
      }
    } finally {
      if (sessionId === sessionRef.current) operationRef.current = false;
    }
  }

  async function updateGeneral(general: GeneralSettings): Promise<void> {
    const desktop = getDesktopApi();

    if (!desktop || !state.settings) return;

    await mutate({
      operation: "general",
      successMessage: t("saved"),
      failureMessage: t("saveError"),
      run: async () => ({ settings: await desktop.settings.updateGeneral(general) }),
    });
  }

  async function chooseDirectory(): Promise<void> {
    const desktop = getDesktopApi();

    if (!desktop) return;

    await mutate({
      operation: "directory",
      successMessage: t("storageUpdated"),
      failureMessage: t("storageError"),
      run: async () => {
        const settings = await desktop.settings.chooseRecordingsDirectory();

        return settings ? { settings } : null;
      },
    });
  }

  async function openDirectory(): Promise<void> {
    const desktop = getDesktopApi();

    if (!desktop) return;

    await mutate({
      operation: "open-directory",
      failureMessage: t("storageError"),
      run: async () => {
        await desktop.settings.openRecordingsDirectory();

        return null;
      },
    });
  }

  async function saveKey(): Promise<void> {
    const desktop = getDesktopApi();
    const { provider, draft } = state.keyEditor;
    const key = draft.trim();

    if (!desktop || !provider || !key) return;

    await mutate({
      operation: `key-${provider}`,
      successMessage: t("keySaved"),
      failureMessage: t("keyError"),
      run: async () => ({
        keyStatus: (await desktop.settings.setAiProviderKey({ provider, key })).keyStatus,
        completedKeyEditor: state.keyEditor,
      }),
    });
  }

  async function removeKey(provider: AiProvider): Promise<void> {
    const desktop = getDesktopApi();

    if (!desktop) return;

    await mutate({
      operation: `remove-${provider}`,
      successMessage: t("keyRemoved"),
      failureMessage: t("keyError"),
      run: async () => ({
        keyStatus: await desktop.settings.removeAiProviderKey({ provider }),
        completedKeyEditor: state.keyEditor.provider === provider ? state.keyEditor : undefined,
      }),
    });
  }

  return {
    ...state,
    notice: state.notice?.message ?? null,
    isLoading: state.busy === "loading",
    isBusy: state.busy !== null,
    updateGeneral,
    chooseDirectory,
    openDirectory,
    saveKey,
    removeKey,
    toggleKeyEditor: (provider: AiProvider) => dispatch({ type: "key-editor-toggled", provider }),
    changeKeyDraft: (draft: string) => dispatch({ type: "key-draft-changed", draft }),
  };
}

function messageFromError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
