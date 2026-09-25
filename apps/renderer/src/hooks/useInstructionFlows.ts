import { useCallback, useEffect, useReducer, useRef } from "react";
import { useTranslations } from "next-intl";
import {
  BUILT_IN_FLOWS,
  parseInstructionFlowState,
  resolveInstructionFlows,
  type InstructionFlowIcon,
  type InstructionFlow,
  type InstructionFlowState,
} from "@path/shared";
import { getDesktopApi } from "../lib/Desktop";
import { getErrorMessage } from "../lib/ErrorMessage";

interface FlowEditor {
  editingId: string | null;
  isBuiltIn: boolean;
  name: string;
  instructions: string;
  icon: InstructionFlowIcon;
  original: InstructionFlow | null;
  error: string | null;
}

interface FlowWorkflow {
  flows: InstructionFlowState;
  loaded: boolean;
  isBusy: boolean;
  error: string | null;
  editor: FlowEditor | null;
}

type FlowAction =
  | { type: "snapshot"; flows: InstructionFlowState; loaded?: boolean }
  | { type: "load-failed"; error: string }
  | { type: "busy"; value: boolean }
  | { type: "saved"; flows: InstructionFlowState; editor: FlowEditor | null }
  | { type: "failed"; error: string; editor?: FlowEditor | null }
  | { type: "edit"; editor: FlowEditor | null }
  | { type: "draft"; changes: Partial<Pick<FlowEditor, "name" | "instructions" | "icon">> };

function reduceFlows(state: FlowWorkflow, action: FlowAction): FlowWorkflow {
  switch (action.type) {
    case "snapshot":
      return {
        ...state,
        flows: action.flows.revision >= state.flows.revision ? action.flows : state.flows,
        loaded: action.loaded ?? state.loaded,
      };
    case "load-failed":
      return { ...state, error: action.error };
    case "busy":
      return { ...state, isBusy: action.value, error: action.value ? null : state.error };
    case "saved":
      return {
        ...state,
        flows: action.flows.revision >= state.flows.revision ? action.flows : state.flows,
        editor: action.editor === state.editor ? null : state.editor,
        error: null,
      };
    case "failed":
      return action.editor && action.editor === state.editor
        ? { ...state, editor: { ...state.editor, error: action.error } }
        : { ...state, error: action.error };
    case "edit":
      return { ...state, editor: action.editor };
    case "draft":
      return state.editor
        ? { ...state, editor: { ...state.editor, ...action.changes, error: null } }
        : state;
  }
}

/** Desktop snapshots synchronize saved prompts; editor drafts stay local until a successful save. */
export function useInstructionFlows({ selectOnCreate = true }: { selectOnCreate?: boolean } = {}) {
  const t = useTranslations();
  const [state, dispatch] = useReducer(reduceFlows, {
    flows: parseInstructionFlowState(null),
    loaded: false,
    isBusy: false,
    error: null,
    editor: null,
  });

  const sessionRef = useRef(0);
  const operationRef = useRef(false);
  const allFlows = resolveInstructionFlows(state.flows);
  const builtInFlows = allFlows.filter((flow) => BUILT_IN_FLOWS.some(({ id }) => id === flow.id));
  const selectedFlow =
    allFlows.find(({ id }) => id === state.flows.selectedId) ?? BUILT_IN_FLOWS[0];

  useEffect(() => {
    const session = ++sessionRef.current;
    const api = getDesktopApi()?.instructionFlows;
    const unsubscribe = api?.onChanged((flows) => {
      if (session === sessionRef.current) dispatch({ type: "snapshot", flows });
    });

    async function load(): Promise<void> {
      try {
        if (!api) {
          dispatch({ type: "snapshot", flows: parseInstructionFlowState(null), loaded: true });

          return;
        }

        const flows = await api.get();

        if (session === sessionRef.current) dispatch({ type: "snapshot", flows, loaded: true });
      } catch (error) {
        if (session === sessionRef.current) {
          dispatch({ type: "load-failed", error: getErrorMessage(error, t("settings.loadError")) });
        }
      }
    }

    void load();

    return () => {
      sessionRef.current += 1;
      unsubscribe?.();
    };
  }, [t]);

  const closeEditor = useCallback(() => {
    if (!operationRef.current) dispatch({ type: "edit", editor: null });
  }, []);

  async function mutate(
    run: (
      api: NonNullable<ReturnType<typeof getDesktopApi>>["instructionFlows"],
    ) => Promise<InstructionFlowState>,
    editor: FlowEditor | null = null,
  ): Promise<boolean> {
    if (!state.loaded || operationRef.current) return false;
    const api = getDesktopApi()?.instructionFlows;

    if (!api) {
      dispatch({ type: "failed", editor, error: t("settings.desktopRequired") });

      return false;
    }

    const session = sessionRef.current;

    operationRef.current = true;
    dispatch({ type: "busy", value: true });
    try {
      const flows = await run(api);

      if (session !== sessionRef.current) return false;
      dispatch({ type: "saved", flows, editor });

      return true;
    } catch (error) {
      if (session === sessionRef.current) {
        dispatch({
          type: "failed",
          editor,
          error: getErrorMessage(error, t("settings.saveError")),
        });
      }

      return false;
    } finally {
      operationRef.current = false;
      if (session === sessionRef.current) dispatch({ type: "busy", value: false });
    }
  }

  async function selectFlow(id: string): Promise<boolean> {
    if (!state.loaded || operationRef.current) return false;
    if (id === "create") {
      dispatch({
        type: "edit",
        editor: {
          editingId: null,
          isBuiltIn: false,
          name: "",
          instructions: "",
          icon: "file-text",
          original: null,
          error: null,
        },
      });

      return true;
    }

    if (!allFlows.some((flow) => flow.id === id)) return false;

    return mutate((api) => api.select({ id }));
  }

  function editFlow(id: string): void {
    if (!state.loaded || operationRef.current) return;
    const flow = allFlows.find((candidate) => candidate.id === id);

    if (!flow) return;
    dispatch({
      type: "edit",
      editor: {
        editingId: flow.id,
        isBuiltIn: builtInFlows.some((candidate) => candidate.id === id),
        name: flow.name,
        instructions: flow.instructions,
        icon: flow.icon,
        original: flow,
        error: null,
      },
    });
  }

  async function saveFlow(): Promise<boolean> {
    const editor = state.editor;

    if (!editor) return false;
    const name = editor.name.trim();
    const instructions = editor.instructions.trim();

    if (!name || !instructions) {
      dispatch({ type: "failed", editor, error: t("guide.flowRequired") });

      return false;
    }

    if (
      allFlows.some(
        (flow) => flow.id !== editor.editingId && flow.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      dispatch({ type: "failed", editor, error: t("guide.flowDuplicate") });

      return false;
    }

    return mutate(
      (api) =>
        api.save({
          ...(editor.editingId ? { id: editor.editingId } : {}),
          ...(editor.original
            ? {
                expected: {
                  name: editor.original.name,
                  instructions: editor.original.instructions,
                  icon: editor.original.icon,
                },
              }
            : {}),
          name,
          instructions,
          icon: editor.icon,
          select: !editor.editingId && selectOnCreate,
        }),
      editor,
    );
  }

  async function deleteFlow(): Promise<boolean> {
    const editor = state.editor;

    if (!editor?.editingId || editor.isBuiltIn) return false;
    const id = editor.editingId;

    return mutate((api) => api.remove({ id }), editor);
  }

  return {
    selectedFlow,
    builtInFlows,
    customFlows: state.flows.customFlows,
    loaded: state.loaded,
    isBusy: state.isBusy,
    error: state.error,
    editor: state.editor,
    selectFlow,
    editFlow,
    editSelectedFlow: () => editFlow(selectedFlow.id),
    closeEditor,
    renameDraft: (name: string) => {
      if (!state.editor?.isBuiltIn) dispatch({ type: "draft", changes: { name } });
    },
    reviseInstructions: (instructions: string) =>
      dispatch({ type: "draft", changes: { instructions } }),
    changeIcon: (icon: InstructionFlowIcon) => dispatch({ type: "draft", changes: { icon } }),
    saveFlow,
    deleteFlow,
  };
}
