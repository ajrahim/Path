import { useEffect, useEffectEvent, useReducer, useRef } from "react";
import { useTranslations } from "next-intl";
import {
  hasDuplicateWorkflowTitle,
  isWorkflowTitleLengthValid,
  MAX_GENERATED_DOCUMENTS,
  type DocumentGenerationMode,
  type DocumentWorkflow,
  type GuideDocumentCollection,
  type GuideDocumentSummary,
} from "@path/shared";
import { getDesktopApi } from "@/lib/Desktop";
import { getErrorMessage } from "@/lib/ErrorMessage";

interface CollectionState extends GuideDocumentCollection {
  activeDocumentId: string | null;
  loading: boolean;
  pending: boolean;
  error: string | null;
}

/** Mutable per-recording guards shared by the collection's async operations. */
interface CollectionSession {
  active: boolean;
  pending: boolean;
  suggested: boolean;
}

type CollectionAction =
  | { type: "reset"; recordingId: string; loading: boolean }
  | { type: "loaded"; collection: GuideDocumentCollection; selectFirst?: boolean }
  | { type: "select"; id: string }
  | { type: "pending"; pending: boolean }
  | { type: "error"; error: string };

const EMPTY_COLLECTION: CollectionState = {
  recordingId: "",
  mode: "combine",
  documents: [],
  workflows: null,
  planVersion: 0,
  activeDocumentId: null,
  loading: false,
  pending: false,
  error: null,
};

function reduceCollection(state: CollectionState, action: CollectionAction): CollectionState {
  switch (action.type) {
    case "reset":
      return { ...EMPTY_COLLECTION, recordingId: action.recordingId, loading: action.loading };
    case "loaded":
      return {
        ...state,
        ...action.collection,
        loading: false,
        error: null,
        activeDocumentId: resolveActiveDocumentId(
          state.activeDocumentId,
          action.collection,
          action.selectFirst,
        ),
      };

    case "select":
      return { ...state, activeDocumentId: action.id };
    case "pending":
      return { ...state, pending: action.pending };
    case "error":
      return { ...state, loading: false, error: action.error };
  }
}

function resolveActiveDocumentId(
  currentId: string | null,
  collection: GuideDocumentCollection,
  selectFirst = false,
): string | null {
  const choices = collection.mode === "split" ? (collection.workflows ?? []) : collection.documents;

  if (selectFirst) return choices[0]?.id ?? null;

  // Combine mode also accepts a workflow selection so switching modes keeps the current tab.
  const selectable =
    collection.mode === "split" ? choices : [...choices, ...(collection.workflows ?? [])];

  if (selectable.some((candidate) => candidate.id === currentId)) return currentId;

  return choices[0]?.id ?? null;
}

export function useGuideCollection(recordingId?: string, instructions?: string) {
  const t = useTranslations("guide");
  const [state, dispatch] = useReducer(reduceCollection, EMPTY_COLLECTION);
  const sessionRef = useRef<CollectionSession | null>(null);

  useEffect(() => {
    const desktop = getDesktopApi();
    const session = { active: true, pending: false, suggested: false };
    const id = recordingId;
    let requestNumber = 0;

    sessionRef.current = session;

    dispatch({
      type: "reset",
      recordingId: id ?? "",
      loading: Boolean(id && desktop),
    });
    if (!id || !desktop) return;

    const guides = desktop.guides;
    const collectionId = id;

    function refresh(): void {
      const request = ++requestNumber;

      void guides.getCollection({ id: collectionId }).then(
        (collection) => {
          if (session.active && request === requestNumber) dispatch({ type: "loaded", collection });
        },
        (error: unknown) => {
          if (session.active && request === requestNumber) {
            dispatch({ type: "error", error: getErrorMessage(error, t("loadFailed")) });
          }
        },
      );
    }

    refresh();
    const unsubscribe = guides.onChanged((change) => {
      if (change.recordingId === collectionId && change.collectionChanged) refresh();
    });

    return () => {
      session.active = false;
      unsubscribe();
    };
  }, [recordingId, t]);

  /** Runs one collection update at a time and surfaces failures on the collection. */
  async function runPendingUpdate(
    session: CollectionSession,
    operation: () => Promise<boolean>,
  ): Promise<boolean> {
    session.pending = true;
    dispatch({ type: "pending", pending: true });
    try {
      return await operation();
    } catch (error) {
      if (session.active) {
        dispatch({ type: "error", error: getErrorMessage(error, t("structureSaveFailed")) });
      }

      return false;
    } finally {
      session.pending = false;
      if (session.active) dispatch({ type: "pending", pending: false });
    }
  }

  async function setMode(
    mode: DocumentGenerationMode,
    flowInstructions = instructions,
  ): Promise<void> {
    const desktop = getDesktopApi();
    const id = recordingId;
    const session = sessionRef.current;

    if (!desktop || !id || !session?.active || session.pending) return;
    if (mode === "split" && flowInstructions !== undefined) session.suggested = true;

    await runPendingUpdate(session, async () => {
      let collection = await desktop.guides.setGenerationMode({ id, mode });

      if (session.active) dispatch({ type: "loaded", collection });
      if (
        session.active &&
        mode === "split" &&
        collection.workflows === null &&
        flowInstructions !== undefined
      ) {
        collection = await desktop.guides.suggestWorkflows({
          id,
          instructions: flowInstructions,
          expectedPlanVersion: collection.planVersion,
        });
        if (session.active) dispatch({ type: "loaded", collection });
      }

      return session.active;
    });
  }

  async function savePlan(workflows: DocumentWorkflow[]): Promise<boolean> {
    const desktop = getDesktopApi();
    const session = sessionRef.current;

    if (!desktop || !recordingId || !session?.active || session.pending) return false;

    return runPendingUpdate(session, async () => {
      // The plan schema is strict: local document links never cross the bridge.
      const collection = await desktop.guides.saveWorkflowPlan({
        id: recordingId,
        workflows: workflows.map(({ id, title, scope }) => ({ id, title, scope })),
        expectedPlanVersion: state.planVersion,
      });

      if (session.active) dispatch({ type: "loaded", collection });

      return session.active;
    });
  }

  async function addWorkflow(title: string): Promise<boolean> {
    const trimmed = title.trim();
    const workflows = state.workflows ?? [];

    if (
      !isWorkflowTitleLengthValid(trimmed) ||
      workflows.length >= MAX_GENERATED_DOCUMENTS ||
      hasDuplicateWorkflowTitle(workflows, trimmed)
    ) {
      return false;
    }

    return savePlan([...workflows, { id: crypto.randomUUID(), title: trimmed, scope: trimmed }]);
  }

  async function renameWorkflow(id: string, title: string): Promise<boolean> {
    const trimmed = title.trim();
    const workflows = state.workflows ?? [];
    const target = workflows.find((candidate) => candidate.id === id);

    if (
      !target ||
      !isWorkflowTitleLengthValid(trimmed) ||
      hasDuplicateWorkflowTitle(workflows, trimmed, id)
    ) {
      return false;
    }

    if (target.title === trimmed) return true;

    return savePlan(
      workflows.map((candidate) =>
        candidate.id === id ? { ...candidate, title: trimmed } : candidate,
      ),
    );
  }

  async function moveWorkflow(id: string, targetId: string, placeAfter: boolean): Promise<boolean> {
    const workflows = state.workflows ?? [];
    const source = workflows.find((candidate) => candidate.id === id);

    if (!source || !workflows.some((candidate) => candidate.id === targetId)) return false;
    if (id === targetId) return true;

    const reordered = workflows.filter((candidate) => candidate.id !== id);
    const targetIndex = reordered.findIndex((candidate) => candidate.id === targetId);

    reordered.splice(targetIndex + (placeAfter ? 1 : 0), 0, source);
    if (reordered.every((candidate, index) => candidate.id === workflows[index]?.id)) return true;

    return savePlan(reordered);
  }

  async function removeWorkflow(id: string): Promise<boolean> {
    return savePlan((state.workflows ?? []).filter((candidate) => candidate.id !== id));
  }

  const suggestMissingPlan = useEffectEvent(() => {
    void setMode("split", instructions);
  });

  useEffect(() => {
    if (
      state.loading ||
      state.pending ||
      state.recordingId !== recordingId ||
      state.mode !== "split" ||
      state.workflows !== null ||
      instructions === undefined ||
      sessionRef.current?.suggested
    ) {
      return;
    }

    suggestMissingPlan();
  }, [
    instructions,
    recordingId,
    state.loading,
    state.pending,
    state.recordingId,
    state.mode,
    state.workflows,
  ]);

  // State from a previous recording must not leak into the newly selected one.
  const isStale = state.recordingId !== (recordingId ?? "");

  return {
    ...state,
    loading: state.loading || isStale,
    activeDocument: isStale ? null : selectActiveDocument(state),
    setMode,
    addWorkflow,
    renameWorkflow,
    moveWorkflow,
    removeWorkflow,
    selectDocument: (id: string) => dispatch({ type: "select", id }),
    adoptCollection: (collection: GuideDocumentCollection) =>
      dispatch({ type: "loaded", collection, selectFirst: true }),
  };
}

/**
 * The document the editor shows. A split tab without generated output has no document yet;
 * combine mode without documents falls back to the legacy single document.
 */
function selectActiveDocument(state: CollectionState): GuideDocumentSummary | null | undefined {
  const workflow = state.workflows?.find((candidate) => candidate.id === state.activeDocumentId);

  if (workflow?.documentId) return { id: workflow.documentId, title: workflow.title };
  if (workflow || state.mode === "split") return null;

  return state.documents.find((document) => document.id === state.activeDocumentId);
}
