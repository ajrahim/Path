import type {
  DocumentRevisionSummary,
  GuideContextItem,
  GuideDocumentChange,
  GuideDocumentSnapshot,
  RecordingSummary,
} from "@path/shared";
import { useEffect, useReducer, useRef, type RefObject } from "react";
import { useTranslations } from "next-intl";
import { getDesktopApi } from "@/lib/Desktop";
import { subscribeGuideImages } from "@/lib/GuideImageBus";
import { renderMarkdownToHtml } from "@/lib/RenderMarkdown";
import { getErrorMessage } from "@/lib/ErrorMessage";

/** Unsaved text is written as a recovery draft once typing pauses for this long. */
export const DRAFT_AUTOSAVE_DELAY_MS = 1_000;
const REVISION_PAGE_SIZE = 50;

/**
 * Recovery-draft persistence, separate from explicit saves: `pending` has unwritten edits,
 * `stored` means the unsaved text survives a restart, and `conflict` means another editor wrote
 * a newer draft, so autosave stops until this editor saves explicitly.
 */
type DraftStatus = "clean" | "pending" | "stored" | "failed" | "conflict";

interface RevisionPreview {
  number: number;
  markdown: string;
}

interface DocumentState {
  markdown: string;
  savedMarkdown: string;
  savedRevisionNumber: number | null;
  /** When the last explicit save committed; a recovery draft never changes it. */
  savedAt: string | null;
  /** The revision the editor text came from; later edits are unsaved changes to it. */
  currentRevisionNumber: number | null;
  loading: boolean;
  generating: boolean;
  updating: boolean;
  exporting: boolean;
  saving: boolean;
  restoring: boolean;
  copied: boolean;
  error: string | null;
  notice: string | null;
  canRetryGenerate: boolean;
  draftStatus: DraftStatus;
  isRecoveredDraft: boolean;
  revisions: DocumentRevisionSummary[];
  hasOlderRevisions: boolean;
  preview: RevisionPreview | null;
}

const EMPTY_DOCUMENT: DocumentState = {
  markdown: "",
  savedMarkdown: "",
  savedRevisionNumber: null,
  savedAt: null,
  currentRevisionNumber: null,
  loading: false,
  generating: false,
  updating: false,
  exporting: false,
  saving: false,
  restoring: false,
  copied: false,
  error: null,
  notice: null,
  canRetryGenerate: false,
  draftStatus: "clean",
  isRecoveredDraft: false,
  revisions: [],
  hasOlderRevisions: false,
  preview: null,
};

type DocumentAction =
  | { type: "reset" }
  | { type: "loading"; loading: boolean }
  | {
      type: "loaded";
      markdown: string;
      savedMarkdown: string;
      savedRevisionNumber: number | null;
      savedAt: string | null;
      currentRevisionNumber: number | null;
      hasDraft: boolean;
    }
  | { type: "edited"; markdown: string }
  | { type: "saved"; markdown: string; savedRevisionNumber: number; savedAt: string }
  | { type: "adopted"; revisionNumber: number }
  | {
      type: "pending";
      operation: "generating" | "updating" | "exporting" | "saving" | "restoring";
      pending: boolean;
    }
  | { type: "copied"; copied: boolean }
  | { type: "error"; error: string | null; canRetryGenerate?: boolean }
  | { type: "notice"; notice: string | null }
  | { type: "draft-status"; status: DraftStatus }
  | { type: "revisions"; revisions: DocumentRevisionSummary[]; hasOlder: boolean; append: boolean }
  | { type: "preview"; preview: RevisionPreview | null };

// Editing invalidates copy confirmation while each asynchronous operation retains its own status.
function reduceDocument(state: DocumentState, action: DocumentAction): DocumentState {
  switch (action.type) {
    case "reset":
      return EMPTY_DOCUMENT;

    case "loading":
      return { ...state, loading: action.loading };

    case "loaded":
      return {
        ...state,
        markdown: action.markdown,
        savedMarkdown: action.savedMarkdown,
        savedRevisionNumber: action.savedRevisionNumber,
        savedAt: action.savedAt,
        currentRevisionNumber: action.currentRevisionNumber,
        draftStatus: action.hasDraft ? "stored" : "clean",
        isRecoveredDraft: action.hasDraft,
        loading: false,
      };

    case "edited":
      return {
        ...state,
        markdown: action.markdown,
        copied: false,
        canRetryGenerate: false,
        notice: null,
        isRecoveredDraft: false,
      };

    case "saved":
      return {
        ...state,
        savedMarkdown: action.markdown,
        savedRevisionNumber: action.savedRevisionNumber,
        savedAt: action.savedAt,
        currentRevisionNumber: action.savedRevisionNumber,
        isRecoveredDraft: false,
      };

    case "adopted":
      return { ...state, currentRevisionNumber: action.revisionNumber };

    case "pending":
      return {
        ...state,
        [action.operation]: action.pending,
        error: action.pending ? null : state.error,
        canRetryGenerate: action.pending ? false : state.canRetryGenerate,
      };

    case "copied":
      return { ...state, copied: action.copied };

    case "error":
      return {
        ...state,
        error: action.error,
        canRetryGenerate: action.canRetryGenerate ?? false,
      };

    case "notice":
      return { ...state, notice: action.notice };

    case "draft-status":
      return { ...state, draftStatus: action.status };

    case "revisions":
      return {
        ...state,
        revisions: action.append ? [...state.revisions, ...action.revisions] : action.revisions,
        hasOlderRevisions: action.hasOlder,
      };

    case "preview":
      return { ...state, preview: action.preview };
  }
}

interface DocumentSession {
  active: boolean;
  recordingId: string | undefined;
  markdown: string;
  /** Increments on every editor change; asynchronous results check it before applying. */
  revision: number;
  copying: number;
  generating: boolean;
  updating: boolean;
  exporting: boolean;
  saving: boolean;
  restoring: boolean;
  isLoaded: boolean;
  /** Concurrency tokens from the desktop; stale writes are rejected against them. */
  savedRevisionNumber: number | null;
  draftVersion: number;
  latestRevisionNumber: number | null;
  savedMarkdown: string;
  /** Text that is already durable, as the saved revision or as the recovery draft. */
  persistedMarkdown: string;
  hasDraftConflict: boolean;
  draftTimer?: ReturnType<typeof setTimeout>;
  draftWrites: Promise<boolean>;
  localWrites: number;
  readers: Set<FileReader>;
  copiedTimer?: ReturnType<typeof setTimeout>;
  focusFrame?: number;
}

interface GuideDocument extends DocumentState {
  isDirty: boolean;
  markdownInputRef: RefObject<HTMLTextAreaElement | null>;
  editMarkdown(markdown: string): void;
  insertImages(files: File[]): Promise<void>;
  insertGuideImage(dataUrl: string, alt: string): void;
  copyMarkdown(): Promise<void>;
  exportMarkdown(): Promise<void>;
  saveDocument(): Promise<boolean>;
  discardChanges(): Promise<boolean>;
  generateGuide(instructions: string): Promise<void>;
  updateGuide(
    instructions: string,
    updatePrompt: string,
    context?: GuideContextItem[],
    contextFolder?: string,
  ): Promise<boolean>;
  previewRevision(number: number | null): Promise<void>;
  restoreRevision(number: number): Promise<boolean>;
  loadOlderRevisions(): Promise<void>;
}

/** Draft status once pending writes are done: text newer than the durable copy is still pending. */
function persistedDraftStatus(session: DocumentSession): DraftStatus {
  if (session.markdown !== session.persistedMarkdown) return "pending";

  return session.persistedMarkdown === session.savedMarkdown ? "clean" : "stored";
}

/**
 * Owns one recording's Markdown editor. The saved document, recovery draft, and revision
 * history are durable in the desktop; this hook keeps the editor text, debounces draft writes,
 * and applies asynchronous results only when they still belong to the current text.
 */
export function useGuideDocument(
  recording: Pick<RecordingSummary, "id" | "title"> | null,
): GuideDocument {
  const t = useTranslations();
  const [state, dispatch] = useReducer(reduceDocument, EMPTY_DOCUMENT);
  const sessionRef = useRef<DocumentSession | null>(null);
  const markdownInputRef = useRef<HTMLTextAreaElement>(null);
  const recordingId = recording?.id;

  useEffect(() => {
    const session: DocumentSession = {
      active: true,
      recordingId,
      markdown: "",
      revision: 0,
      copying: 0,
      generating: false,
      updating: false,
      exporting: false,
      saving: false,
      restoring: false,
      isLoaded: false,
      savedRevisionNumber: null,
      draftVersion: 0,
      latestRevisionNumber: null,
      savedMarkdown: "",
      persistedMarkdown: "",
      hasDraftConflict: false,
      draftWrites: Promise.resolve(true),
      localWrites: 0,
      readers: new Set(),
    };

    sessionRef.current = session;
    dispatch({ type: "reset" });

    const desktop = getDesktopApi();
    const disposers: (() => void)[] = [];

    if (recordingId && desktop) {
      dispatch({ type: "loading", loading: true });

      desktop.guides
        .getDocument({ id: recordingId })
        .then((snapshot) => {
          // Text inserted while the document loaded (such as a screenshot) is kept.
          if (session.active) applySnapshot(session, snapshot, session.revision !== 0);
        })
        .catch((error: unknown) => {
          if (session.active) {
            dispatch({ type: "loading", loading: false });
            dispatch({ type: "error", error: getErrorMessage(error, t("guide.loadFailed")) });
          }
        });

      // Quitting waits for this editor's pending draft so unsaved text survives the restart.
      disposers.push(desktop.app.onFlushRequested(() => flushDraft(session).then(() => undefined)));
      disposers.push(
        desktop.guides.onChanged((change) => {
          if (session.active) applyRemoteChange(session, change);
        }),
      );
    }

    disposers.push(
      subscribeGuideImages((image) => {
        if (session.active) {
          insertSnippet(session, imageSnippet(image.dataUrl, image.alt, t("guide.imageAlt")));
        }
      }),
    );

    return () => {
      // IPC generation/export cannot be canceled. Invalidate their completions, keep a pending
      // draft durable, and release the browser resources that this recording owns.
      session.active = false;
      for (const dispose of disposers) dispose();
      void flushDraft(session);
      clearTimeout(session.copiedTimer);
      if (session.focusFrame !== undefined) cancelAnimationFrame(session.focusFrame);

      for (const reader of session.readers) reader.abort();
    };
    // The translators and recording identity define this effect; markdown edits stay in the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingId]);

  function applySnapshot(
    session: DocumentSession,
    snapshot: GuideDocumentSnapshot,
    keepEditorText = false,
  ): void {
    const savedMarkdown = snapshot.saved?.markdown ?? "";
    const persistedMarkdown = snapshot.draft?.markdown ?? savedMarkdown;
    const markdown = keepEditorText ? session.markdown : persistedMarkdown;

    session.markdown = markdown;
    session.revision += 1;
    session.isLoaded = true;
    session.savedRevisionNumber = snapshot.saved?.revisionNumber ?? null;
    session.draftVersion = snapshot.draftVersion;
    session.latestRevisionNumber = snapshot.latestRevisionNumber;
    session.savedMarkdown = savedMarkdown;
    session.persistedMarkdown = persistedMarkdown;
    session.hasDraftConflict = false;
    dispatch({
      type: "loaded",
      markdown,
      savedMarkdown,
      savedRevisionNumber: session.savedRevisionNumber,
      savedAt: snapshot.saved?.savedAt ?? null,
      // A draft continues from the newest revision; otherwise the text is the saved revision.
      currentRevisionNumber: snapshot.draft
        ? snapshot.latestRevisionNumber
        : session.savedRevisionNumber,
      hasDraft: snapshot.draft !== null,
    });
    void refreshRevisions(session);
    scheduleDraft(session);
  }

  /** Another window committed a change; history refreshes, and a clean editor follows a newer save. */
  function applyRemoteChange(session: DocumentSession, change: GuideDocumentChange): void {
    const desktop = getDesktopApi();

    if (!desktop || change.recordingId !== session.recordingId || session.localWrites > 0) return;

    const isKnown =
      change.draftVersion === session.draftVersion &&
      change.savedRevisionNumber === session.savedRevisionNumber &&
      change.latestRevisionNumber === session.latestRevisionNumber;

    if (isKnown) return;

    session.latestRevisionNumber = change.latestRevisionNumber;
    void refreshRevisions(session);

    const isClean = session.markdown === session.persistedMarkdown && !session.draftTimer;

    if (!isClean || change.savedRevisionNumber === session.savedRevisionNumber) return;

    desktop.guides
      .getDocument({ id: change.recordingId })
      .then((snapshot) => {
        if (session.active && session.markdown === session.persistedMarkdown) {
          applySnapshot(session, snapshot);
        }
      })
      .catch(() => undefined);
  }

  async function refreshRevisions(session: DocumentSession): Promise<void> {
    const desktop = getDesktopApi();

    if (!desktop || !session.recordingId) return;

    try {
      const page = await desktop.guides.listRevisions({
        id: session.recordingId,
        limit: REVISION_PAGE_SIZE,
      });

      if (session.active) {
        dispatch({
          type: "revisions",
          revisions: page.revisions,
          hasOlder: page.hasMore,
          append: false,
        });
      }
    } catch {
      // History is optional context for the editor; the document itself stays usable.
    }
  }

  async function loadOlderRevisions(): Promise<void> {
    const session = sessionRef.current;
    const desktop = getDesktopApi();
    const oldest = state.revisions.at(-1);

    if (!session?.active || !desktop || !session.recordingId || !oldest) return;

    try {
      const page = await desktop.guides.listRevisions({
        id: session.recordingId,
        beforeNumber: oldest.number,
        limit: REVISION_PAGE_SIZE,
      });

      if (session.active) {
        dispatch({
          type: "revisions",
          revisions: page.revisions,
          hasOlder: page.hasMore,
          append: true,
        });
      }
    } catch (error) {
      if (session.active) {
        dispatch({ type: "error", error: getErrorMessage(error, t("guide.historyFailed")) });
      }
    }
  }

  function commitMarkdown(session: DocumentSession, markdown: string): void {
    session.markdown = markdown;
    session.revision += 1;
    clearTimeout(session.copiedTimer);
    dispatch({ type: "edited", markdown });
  }

  /** Debounces a recovery-draft write; never on every keystroke. */
  function scheduleDraft(session: DocumentSession): void {
    if (!session.isLoaded || session.hasDraftConflict) return;

    clearTimeout(session.draftTimer);

    // Typing back to the durable text needs no write; the status reflects what is stored.
    if (session.markdown === session.persistedMarkdown) {
      session.draftTimer = undefined;
      dispatch({ type: "draft-status", status: persistedDraftStatus(session) });

      return;
    }

    dispatch({ type: "draft-status", status: "pending" });
    session.draftTimer = setTimeout(() => void flushDraft(session), DRAFT_AUTOSAVE_DELAY_MS);
  }

  /** Writes any pending draft now; writes stay in order and each one waits for the last. */
  function flushDraft(session: DocumentSession): Promise<boolean> {
    clearTimeout(session.draftTimer);
    session.draftTimer = undefined;
    session.draftWrites = session.draftWrites.then(() => writeDraft(session));

    return session.draftWrites;
  }

  async function writeDraft(session: DocumentSession): Promise<boolean> {
    const desktop = getDesktopApi();
    const markdown = session.markdown;

    if (!desktop || !session.recordingId || !session.isLoaded || session.hasDraftConflict) {
      return false;
    }

    if (markdown === session.persistedMarkdown) return true;

    session.localWrites += 1;

    try {
      const result = await desktop.guides.saveDraft({
        id: session.recordingId,
        markdown,
        expectedDraftVersion: session.draftVersion,
      });

      if (result.status === "conflict") {
        // Another editor wrote a newer draft; keep this text and require an explicit save.
        session.hasDraftConflict = true;
        if (session.active) {
          dispatch({ type: "draft-status", status: "conflict" });
          dispatch({ type: "error", error: t("guide.draftConflict") });
        }

        return false;
      }

      session.draftVersion = result.draftVersion;
      session.persistedMarkdown = markdown;

      if (session.active) dispatch({ type: "draft-status", status: persistedDraftStatus(session) });

      return true;
    } catch (error) {
      if (session.active) {
        dispatch({ type: "draft-status", status: "failed" });
        dispatch({ type: "error", error: getErrorMessage(error, t("guide.draftFailed")) });
      }

      return false;
    } finally {
      session.localWrites -= 1;
    }
  }

  function editMarkdown(markdown: string): void {
    const session = sessionRef.current;

    if (!session?.active || state.preview) return;

    commitMarkdown(session, markdown);
    scheduleDraft(session);
  }

  function insertGuideImage(dataUrl: string, alt: string): void {
    const session = sessionRef.current;

    if (session?.active) insertSnippet(session, imageSnippet(dataUrl, alt, t("guide.imageAlt")));
  }

  function insertSnippet(session: DocumentSession, snippet: string): void {
    const input = markdownInputRef.current;

    if (!input) {
      commitMarkdown(session, `${session.markdown}${session.markdown ? "\n\n" : ""}${snippet}`);
      scheduleDraft(session);

      return;
    }

    const start = input.selectionStart ?? session.markdown.length;
    const end = input.selectionEnd ?? session.markdown.length;

    commitMarkdown(
      session,
      `${session.markdown.slice(0, start)}${snippet}${session.markdown.slice(end)}`,
    );
    scheduleDraft(session);
    const insertedRevision = session.revision;

    if (session.focusFrame !== undefined) cancelAnimationFrame(session.focusFrame);

    session.focusFrame = requestAnimationFrame(() => {
      if (!session.active || session.revision !== insertedRevision) return;

      const cursor = start + snippet.length;

      input.focus();
      input.setSelectionRange(cursor, cursor);
    });
  }

  async function insertImages(files: File[]): Promise<void> {
    const images = files.filter((file) => file.type.startsWith("image/"));
    const session = sessionRef.current;

    if (!session?.active || images.length === 0) return;

    const revision = session.revision;

    dispatch({ type: "error", error: null });

    try {
      const imageMarkdown = await Promise.all(
        images.map(async (file) => {
          const source = await readImageAsDataUrl(
            file,
            session.readers,
            t("guide.imageInsertFailed"),
          );

          return imageSnippet(source, file.name.replace(/\.[^.]+$/, ""), t("guide.imageAlt"));
        }),
      );

      // The captured selection belongs to this document revision. Never replace
      // edits made while FileReader was loading the images.
      if (!session.active || session.revision !== revision) return;

      insertSnippet(session, imageMarkdown.join("\n\n"));
    } catch (error) {
      if (session.active && session.revision === revision) {
        dispatch({ type: "error", error: getErrorMessage(error, t("guide.imageInsertFailed")) });
      }
    }
  }

  async function copyMarkdown(): Promise<void> {
    const session = sessionRef.current;

    if (!session?.active) return;

    const operation = ++session.copying;
    const revision = session.revision;
    const markdown = state.preview?.markdown ?? session.markdown;

    clearTimeout(session.copiedTimer);
    dispatch({ type: "copied", copied: false });
    dispatch({ type: "error", error: null });

    try {
      let written = false;

      if (
        typeof ClipboardItem !== "undefined" &&
        typeof navigator.clipboard?.write === "function"
      ) {
        try {
          const html = renderMarkdownToHtml(markdown);
          const textBlob = new Blob([markdown], { type: "text/plain" });
          const htmlBlob = new Blob([html], { type: "text/html" });

          await navigator.clipboard.write([
            new ClipboardItem({
              "text/plain": textBlob,
              "text/html": htmlBlob,
            }),
          ]);
          written = true;
        } catch {
          // ClipboardItem write failed or was rejected; fall back to writeText below.
        }
      }

      if (!written) {
        await navigator.clipboard.writeText(markdown);
      }

      if (!session.active || session.copying !== operation || session.revision !== revision) return;

      dispatch({ type: "copied", copied: true });
      session.copiedTimer = setTimeout(() => dispatch({ type: "copied", copied: false }), 2_000);
    } catch (error) {
      if (session.active && session.copying === operation && session.revision === revision) {
        dispatch({ type: "error", error: getErrorMessage(error, t("guide.copyFailed")) });
      }
    }
  }

  async function exportMarkdown(): Promise<void> {
    const session = sessionRef.current;

    if (!recording || !session?.active || session.exporting) return;

    const markdown = state.preview?.markdown ?? session.markdown;

    session.exporting = true;
    dispatch({ type: "pending", operation: "exporting", pending: true });

    try {
      const desktop = getDesktopApi();

      if (desktop) {
        await desktop.guides.exportMarkdown({ suggestedName: recording.title, markdown });
      } else {
        downloadMarkdown(recording.title, markdown);
      }
    } catch (error) {
      if (session.active) {
        dispatch({ type: "error", error: getErrorMessage(error, t("guide.exportFailed")) });
      }
    } finally {
      session.exporting = false;
      if (session.active) dispatch({ type: "pending", operation: "exporting", pending: false });
    }
  }

  /**
   * Explicit save. It resolves true only after the desktop confirms the commit. A save rejected
   * because another editor saved first keeps this text; saving again deliberately replaces it,
   * and the other version stays in history.
   */
  async function saveDocument(): Promise<boolean> {
    const session = sessionRef.current;
    const desktop = getDesktopApi();

    if (!recording || !desktop || !session?.active || session.saving) return false;

    clearTimeout(session.draftTimer);
    session.draftTimer = undefined;
    session.saving = true;
    session.localWrites += 1;
    dispatch({ type: "pending", operation: "saving", pending: true });

    try {
      // A draft write already in flight must finish first so its version is current.
      await session.draftWrites;

      const markdown = session.markdown;
      const result = await desktop.guides.saveDocument({
        id: recording.id,
        markdown,
        expectedSavedRevisionNumber: session.savedRevisionNumber,
        draftVersion: session.draftVersion,
      });

      if (result.status === "conflict") {
        session.savedRevisionNumber = result.savedRevisionNumber;
        if (session.active) {
          dispatch({ type: "error", error: t("guide.saveConflict") });
          void refreshRevisions(session);
        }

        return false;
      }

      session.savedRevisionNumber = result.revision.number;
      session.latestRevisionNumber = Math.max(
        session.latestRevisionNumber ?? 0,
        result.revision.number,
      );
      session.draftVersion = result.draftVersion;
      session.savedMarkdown = markdown;
      session.persistedMarkdown = markdown;
      session.hasDraftConflict = false;

      if (session.active && session.recordingId === recording.id) {
        dispatch({
          type: "saved",
          markdown,
          savedRevisionNumber: result.revision.number,
          savedAt: result.savedAt,
        });
        dispatch({ type: "draft-status", status: "clean" });
        void refreshRevisions(session);
        // Text typed while the save was in flight remains unsaved and becomes a draft.
        scheduleDraft(session);
      }

      return true;
    } catch (error) {
      if (session.active) {
        dispatch({ type: "error", error: getErrorMessage(error, t("guide.saveFailed")) });
      }

      return false;
    } finally {
      session.saving = false;
      session.localWrites -= 1;
      if (session.active) dispatch({ type: "pending", operation: "saving", pending: false });
    }
  }

  /** Discards unsaved text durably, so the recovery draft does not return on the next visit. */
  async function discardChanges(): Promise<boolean> {
    const session = sessionRef.current;
    const desktop = getDesktopApi();

    if (!session?.recordingId || !desktop) return true;

    clearTimeout(session.draftTimer);
    session.draftTimer = undefined;
    await session.draftWrites;

    try {
      let result = await desktop.guides.discardDraft({
        id: session.recordingId,
        expectedDraftVersion: session.draftVersion,
      });

      // The user chose to discard this document's unsaved text, including a newer copy.
      if (result.status === "conflict") {
        result = await desktop.guides.discardDraft({
          id: session.recordingId,
          expectedDraftVersion: result.draftVersion,
        });
      }

      if (result.status === "conflict") throw new Error(t("guide.draftConflict"));

      session.draftVersion = result.draftVersion;
      session.markdown = session.savedMarkdown;
      session.persistedMarkdown = session.savedMarkdown;

      return true;
    } catch (error) {
      if (session.active) {
        dispatch({ type: "error", error: getErrorMessage(error, t("guide.discardFailed")) });
      }

      return false;
    }
  }

  async function generateGuide(instructions: string): Promise<void> {
    const session = sessionRef.current;
    const desktop = getDesktopApi();

    if (
      !recording ||
      !desktop ||
      !session?.active ||
      session.generating ||
      session.updating ||
      session.restoring
    ) {
      return;
    }

    const revision = session.revision;
    const replacedMarkdown = session.markdown;

    session.generating = true;
    dispatch({ type: "preview", preview: null });
    dispatch({ type: "pending", operation: "generating", pending: true });

    try {
      const generated = await desktop.guides.generate({
        id: recording.id,
        instructions,
        ...(replacedMarkdown.trim() ? { replacedMarkdown } : {}),
      });

      adoptCommittedRevision(session, revision, generated.markdown, generated.revision.number);
    } catch (error) {
      if (session.active && session.revision === revision) {
        dispatch({
          type: "error",
          error: getErrorMessage(error, t("guide.generateFailed")),
          canRetryGenerate: true,
        });
      }
    } finally {
      session.generating = false;
      if (session.active) dispatch({ type: "pending", operation: "generating", pending: false });
    }
  }

  async function updateGuide(
    instructions: string,
    updatePrompt: string,
    context?: GuideContextItem[],
    contextFolder?: string,
  ): Promise<boolean> {
    const session = sessionRef.current;
    const desktop = getDesktopApi();
    const request = updatePrompt.trim();

    if (
      !recording ||
      !desktop ||
      !session?.active ||
      !request ||
      session.generating ||
      session.updating ||
      session.restoring
    ) {
      return false;
    }

    const revision = session.revision;
    const currentMarkdown = session.markdown;

    session.updating = true;
    dispatch({ type: "preview", preview: null });
    dispatch({ type: "pending", operation: "updating", pending: true });

    try {
      const updated = await desktop.guides.update({
        id: recording.id,
        instructions,
        currentMarkdown,
        updatePrompt: request,
        ...(context?.length ? { context } : {}),
        ...(contextFolder ? { contextFolder } : {}),
      });

      adoptCommittedRevision(session, revision, updated.markdown, updated.revision.number);

      return true;
    } catch (error) {
      // Updates are retried by sending a new chat prompt, never by regenerating the flow.
      if (session.active && session.revision === revision) {
        dispatch({ type: "error", error: getErrorMessage(error, t("guide.updateFailed")) });
      }

      return false;
    } finally {
      session.updating = false;
      if (session.active) dispatch({ type: "pending", operation: "updating", pending: false });
    }
  }

  /**
   * An AI result is already in history. It replaces the editor text only if nothing changed
   * while the request ran; otherwise the user's edits stay and the result waits in history.
   */
  function adoptCommittedRevision(
    session: DocumentSession,
    requestedAtRevision: number,
    markdown: string,
    revisionNumber: number,
  ): void {
    session.latestRevisionNumber = Math.max(session.latestRevisionNumber ?? 0, revisionNumber);

    if (!session.active) return;

    void refreshRevisions(session);

    if (session.revision !== requestedAtRevision) {
      dispatch({ type: "notice", notice: t("guide.resultKeptInHistory") });

      return;
    }

    commitMarkdown(session, markdown);
    dispatch({ type: "adopted", revisionNumber });
    void flushDraft(session);
  }

  async function previewRevision(number: number | null): Promise<void> {
    const session = sessionRef.current;
    const desktop = getDesktopApi();

    if (!session?.active || !session.recordingId) return;

    if (number === null || !desktop) {
      dispatch({ type: "preview", preview: null });

      return;
    }

    try {
      const revision = await desktop.guides.getRevision({ id: session.recordingId, number });

      if (session.active) {
        dispatch({ type: "preview", preview: { number, markdown: revision.markdown } });
      }
    } catch (error) {
      if (session.active) {
        dispatch({ type: "error", error: getErrorMessage(error, t("guide.historyFailed")) });
      }
    }
  }

  /** Restoring appends the chosen revision to history; the current text is checkpointed first. */
  async function restoreRevision(number: number): Promise<boolean> {
    const session = sessionRef.current;
    const desktop = getDesktopApi();

    if (!session?.active || !session.recordingId || !desktop || session.restoring) return false;
    if (session.generating || session.updating) return false;

    const revision = session.revision;
    const replacedMarkdown = session.markdown;

    session.restoring = true;
    dispatch({ type: "pending", operation: "restoring", pending: true });

    try {
      const restored = await desktop.guides.restoreRevision({
        id: session.recordingId,
        number,
        ...(replacedMarkdown.trim() ? { replacedMarkdown } : {}),
      });

      if (session.active) dispatch({ type: "preview", preview: null });
      adoptCommittedRevision(session, revision, restored.markdown, restored.revision.number);

      return true;
    } catch (error) {
      if (session.active) {
        dispatch({ type: "error", error: getErrorMessage(error, t("guide.restoreFailed")) });
      }

      return false;
    } finally {
      session.restoring = false;
      if (session.active) dispatch({ type: "pending", operation: "restoring", pending: false });
    }
  }

  return {
    ...state,
    isDirty: state.markdown !== state.savedMarkdown,
    markdownInputRef,
    editMarkdown,
    insertImages,
    insertGuideImage,
    copyMarkdown,
    exportMarkdown,
    saveDocument,
    discardChanges,
    generateGuide,
    updateGuide,
    previewRevision,
    restoreRevision,
    loadOlderRevisions,
  };
}

function imageSnippet(source: string, name: string, fallbackAlt: string): string {
  const alt = name.replace(/[\[\]]/g, "");

  return `![${alt || fallbackAlt}](${source})`;
}

function readImageAsDataUrl(
  file: File,
  readers: Set<FileReader>,
  failureMessage: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    readers.add(reader);
    const release = () => {
      readers.delete(reader);
      reader.onload = null;
      reader.onerror = null;
      reader.onabort = null;
    };

    reader.onload = () => {
      const result = reader.result;

      release();
      if (typeof result === "string") resolve(result);
      else reject(new Error(failureMessage));
    };

    reader.onerror = reader.onabort = () => {
      release();
      reject(new Error(failureMessage));
    };

    try {
      reader.readAsDataURL(file);
    } catch (error) {
      release();
      reject(error);
    }
  });
}

function downloadMarkdown(name: string, markdown: string): void {
  const safeName = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").trim() || "guide";
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));

  try {
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = `${safeName}.md`;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
