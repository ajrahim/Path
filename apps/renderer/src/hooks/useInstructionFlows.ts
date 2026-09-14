import { useCallback, useEffect, useReducer } from "react";
import { useTranslations } from "next-intl";
import {
  BUILT_IN_FLOWS,
  FLOW_STORAGE_KEY,
  loadInstructionFlows,
  type InstructionFlow,
  type InstructionFlowState,
} from "../lib/InstructionFlows";

interface FlowEditor {
  mode: "create" | "copy" | "edit";
  editingId: string | null;
  name: string;
  instructions: string;
  error: string | null;
}

interface FlowWorkflow {
  flows: InstructionFlowState;
  loaded: boolean;
  error: string | null;
  editor: FlowEditor | null;
}

type FlowAction =
  | { type: "loaded"; flows: InstructionFlowState }
  | { type: "load-failed"; error: string }
  | { type: "persisted"; flows: InstructionFlowState; closeEditor: boolean }
  | { type: "failed"; error: string }
  | { type: "edit"; editor: FlowEditor | null }
  | { type: "draft"; field: "name" | "instructions"; value: string }
  | { type: "editor-failed"; error: string };

// Saved flows and an unsaved editor draft intentionally advance through separate actions.
function reduceFlows(state: FlowWorkflow, action: FlowAction): FlowWorkflow {
  switch (action.type) {
    case "loaded":
      return { ...state, flows: action.flows, loaded: true, error: null };

    case "load-failed":
      return { ...state, loaded: true, error: action.error };

    case "persisted":
      return {
        ...state,
        flows: action.flows,
        error: null,
        editor: action.closeEditor ? null : state.editor,
      };

    case "failed":
      return { ...state, error: action.error };

    case "edit":
      return { ...state, editor: action.editor };

    case "draft":
      return state.editor
        ? { ...state, editor: { ...state.editor, [action.field]: action.value } }
        : state;

    case "editor-failed":
      return state.editor ? { ...state, editor: { ...state.editor, error: action.error } } : state;
  }
}

interface InstructionFlows {
  selectedFlow: InstructionFlow;
  customFlows: InstructionFlow[];
  loaded: boolean;
  error: string | null;
  editor: FlowEditor | null;
  selectFlow(id: string): void;
  editSelectedFlow(): void;
  closeEditor(): void;
  renameDraft(value: string): void;
  reviseInstructions(value: string): void;
  saveFlow(): void;
  deleteFlow(): void;
}

/** Restores saved instruction flows and owns their create, copy, and edit workflow. */
export function useInstructionFlows(): InstructionFlows {
  const t = useTranslations();
  const [state, dispatch] = useReducer(reduceFlows, {
    flows: { selectedId: "help-guide", customFlows: [] },
    loaded: false,
    error: null,
    editor: null,
  });

  const { flows, editor } = state;
  const closeEditor = useCallback(() => dispatch({ type: "edit", editor: null }), []);
  const selectedFlow =
    [...BUILT_IN_FLOWS, ...flows.customFlows].find((flow) => flow.id === flows.selectedId) ??
    BUILT_IN_FLOWS[0];

  useEffect(() => {
    let active = true;

    function loadFlows(): void {
      try {
        const stored = window.localStorage.getItem(FLOW_STORAGE_KEY);
        const loaded = loadInstructionFlows(stored);

        if (!active) return;

        dispatch({ type: "loaded", flows: loaded });
        window.localStorage.setItem(FLOW_STORAGE_KEY, JSON.stringify(loaded));
      } catch (error) {
        if (active) {
          dispatch({
            type: "load-failed",
            error: error instanceof Error ? error.message : t("settings.loadError"),
          });
        }
      }
    }

    loadFlows();

    return () => {
      active = false;
    };
  }, [t]);

  function persistFlows(next: InstructionFlowState, closeEditor: boolean): void {
    // Commit to storage first: a failed write leaves the selected flow and draft intact.
    window.localStorage.setItem(FLOW_STORAGE_KEY, JSON.stringify(next));
    dispatch({ type: "persisted", flows: next, closeEditor });
  }

  function selectFlow(id: string): void {
    if (!state.loaded) return;

    if (id === "create") {
      dispatch({
        type: "edit",
        editor: { mode: "create", editingId: null, name: "", instructions: "", error: null },
      });

      return;
    }

    if (![...BUILT_IN_FLOWS, ...flows.customFlows].some((flow) => flow.id === id)) return;

    try {
      persistFlows({ ...flows, selectedId: id }, false);
    } catch (error) {
      dispatch({
        type: "failed",
        error: error instanceof Error ? error.message : t("settings.saveError"),
      });
    }
  }

  function editSelectedFlow(): void {
    if (!state.loaded) return;

    const custom = flows.customFlows.some((flow) => flow.id === selectedFlow.id);

    dispatch({
      type: "edit",
      editor: {
        mode: custom ? "edit" : "copy",
        editingId: custom ? selectedFlow.id : null,
        name: custom ? selectedFlow.name : t("guide.customCopy", { name: selectedFlow.name }),
        instructions: selectedFlow.instructions,
        error: null,
      },
    });
  }

  function saveFlow(): void {
    if (!editor) return;

    const name = editor.name.trim();
    const instructions = editor.instructions.trim();

    if (!name || !instructions) {
      dispatch({ type: "editor-failed", error: t("guide.flowRequired") });

      return;
    }

    if (
      [...BUILT_IN_FLOWS, ...flows.customFlows].some(
        (flow) => flow.id !== editor.editingId && flow.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      dispatch({ type: "editor-failed", error: t("guide.flowDuplicate") });

      return;
    }

    try {
      const flow = { id: editor.editingId ?? `custom-${crypto.randomUUID()}`, name, instructions };

      persistFlows(
        {
          selectedId: flow.id,
          customFlows: editor.editingId
            ? flows.customFlows.map((existing) =>
                existing.id === editor.editingId ? flow : existing,
              )
            : [...flows.customFlows, flow],
        },
        true,
      );
    } catch (error) {
      dispatch({
        type: "editor-failed",
        error: error instanceof Error ? error.message : t("settings.saveError"),
      });
    }
  }

  function deleteFlow(): void {
    if (!editor?.editingId) return;

    try {
      persistFlows(
        {
          selectedId: "help-guide",
          customFlows: flows.customFlows.filter((flow) => flow.id !== editor.editingId),
        },
        true,
      );
    } catch (error) {
      dispatch({
        type: "editor-failed",
        error: error instanceof Error ? error.message : t("settings.saveError"),
      });
    }
  }

  return {
    selectedFlow,
    customFlows: flows.customFlows,
    loaded: state.loaded,
    error: state.error,
    editor,
    selectFlow,
    editSelectedFlow,
    closeEditor,
    renameDraft: (value) => dispatch({ type: "draft", field: "name", value }),
    reviseInstructions: (value) => dispatch({ type: "draft", field: "instructions", value }),
    saveFlow,
    deleteFlow,
  };
}
