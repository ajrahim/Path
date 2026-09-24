import type { GuideContextItem } from "@path/shared";
import { useEffect, useReducer, useRef, type RefObject } from "react";
import { useTranslations } from "next-intl";
import type { RecordingSummary } from "@path/shared";
import { getDesktopApi } from "@/lib/Desktop";
import { subscribeGuideImages } from "@/lib/GuideImageBus";
import { renderMarkdownToHtml } from "@/lib/RenderMarkdown";

const MAX_GUIDE_VERSIONS = 20;

interface DocumentState {
  markdown: string;
  savedMarkdown: string;
  loading: boolean;
  generating: boolean;
  updating: boolean;
  exporting: boolean;
  saving: boolean;
  copied: boolean;
  error: string | null;
  canRetryGenerate: boolean;
  versions: string[];
  activeVersion: number;
  atVersion: boolean;
}

const EMPTY_DOCUMENT: DocumentState = {
  markdown: "",
  savedMarkdown: "",
  loading: false,
  generating: false,
  updating: false,
  exporting: false,
  saving: false,
  copied: false,
  error: null,
  canRetryGenerate: false,
  versions: [],
  activeVersion: -1,
  atVersion: false,
};

type DocumentAction =
  | { type: "reset" }
  | { type: "loading"; loading: boolean }
  | { type: "loaded"; markdown: string }
  | { type: "edited"; markdown: string }
  | { type: "saved"; markdown: string }
  | {
      type: "pending";
      operation: "generating" | "updating" | "exporting" | "saving";
      pending: boolean;
    }
  | { type: "copied"; copied: boolean }
  | { type: "error"; error: string | null; canRetryGenerate?: boolean }
  | { type: "versions-seeded"; versions: string[] }
  | { type: "version-committed"; versions: string[]; activeVersion: number }
  | { type: "version-selected"; activeVersion: number }
  | { type: "version-diverged" };

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
        savedMarkdown: action.markdown,
        loading: false,
      };

    case "edited":
      return { ...state, markdown: action.markdown, copied: false, canRetryGenerate: false };

    case "saved":
      return { ...state, savedMarkdown: action.markdown };

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

    case "versions-seeded":
      return {
        ...state,
        versions: action.versions,
        activeVersion: action.versions.length - 1,
        atVersion: action.versions.length > 0,
      };

    case "version-committed":
      return {
        ...state,
        versions: action.versions,
        activeVersion: action.activeVersion,
        atVersion: true,
      };

    case "version-selected":
      return { ...state, activeVersion: action.activeVersion, atVersion: true };

    case "version-diverged":
      return { ...state, atVersion: false };
  }
}

interface DocumentSession {
  active: boolean;
  recordingId: string | undefined;
  markdown: string;
  revision: number;
  copying: number;
  generating: boolean;
  updating: boolean;
  exporting: boolean;
  saving: boolean;
  versions: string[];
  activeVersion: number;
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
  generateGuide(instructions: string): Promise<void>;
  updateGuide(
    instructions: string,
    updatePrompt: string,
    context?: GuideContextItem[],
  ): Promise<boolean>;
  selectVersion(index: number): void;
}

/** Owns one recording's Markdown draft, its persisted document, and browser resources. */
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
      versions: [],
      activeVersion: -1,
      readers: new Set(),
    };

    sessionRef.current = session;
    dispatch({ type: "reset" });

    if (recordingId) {
      const desktop = getDesktopApi();

      if (desktop) {
        dispatch({ type: "loading", loading: true });

        desktop.guides
          .getDocument({ id: recordingId })
          .then((document) => {
            if (!session.active) return;

            if (document) {
              session.markdown = document.markdown;
              session.revision += 1;
              session.versions = document.markdown ? [document.markdown] : [];
              session.activeVersion = session.versions.length - 1;
              dispatch({ type: "loaded", markdown: document.markdown });
              dispatch({ type: "versions-seeded", versions: [...session.versions] });
            } else {
              dispatch({ type: "loading", loading: false });
            }
          })
          .catch((error: unknown) => {
            if (session.active) {
              dispatch({ type: "loading", loading: false });
              dispatch({
                type: "error",
                error: error instanceof Error ? error.message : t("guide.loadFailed"),
              });
            }
          });
      }
    }

    const unsubscribe = subscribeGuideImages((image) => {
      if (session.active) {
        insertSnippet(session, imageSnippet(image.dataUrl, image.alt, t("guide.imageAlt")));
      }
    });

    return () => {
      // IPC generation/export cannot be canceled. Invalidate their completions,
      // and actively release the browser resources that this recording owns.
      session.active = false;
      unsubscribe();
      clearTimeout(session.copiedTimer);
      if (session.focusFrame !== undefined) cancelAnimationFrame(session.focusFrame);

      for (const reader of session.readers) reader.abort();
    };
    // The translators and recording identity define this effect; markdown edits stay in the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingId]);

  function commitMarkdown(session: DocumentSession, markdown: string): void {
    session.markdown = markdown;
    session.revision += 1;
    clearTimeout(session.copiedTimer);
    dispatch({ type: "edited", markdown });
  }

  function commitVersion(session: DocumentSession, markdown: string): void {
    commitMarkdown(session, markdown);

    // Generated output is restorable history; cap it so long sessions stay small.
    session.versions = [...session.versions, markdown].slice(-MAX_GUIDE_VERSIONS);
    session.activeVersion = session.versions.length - 1;

    dispatch({
      type: "version-committed",
      versions: [...session.versions],
      activeVersion: session.activeVersion,
    });
  }

  function editMarkdown(markdown: string): void {
    const session = sessionRef.current;

    if (!session?.active) return;

    commitMarkdown(session, markdown);
    dispatch({ type: "version-diverged" });
  }

  function selectVersion(index: number): void {
    const session = sessionRef.current;
    const version = session?.active ? session.versions[index] : undefined;

    if (!session || version === undefined) return;

    session.activeVersion = index;
    commitMarkdown(session, version);
    dispatch({ type: "version-selected", activeVersion: index });
  }

  function insertGuideImage(dataUrl: string, alt: string): void {
    const session = sessionRef.current;

    if (session?.active) insertSnippet(session, imageSnippet(dataUrl, alt, t("guide.imageAlt")));
  }

  function insertSnippet(session: DocumentSession, snippet: string): void {
    const input = markdownInputRef.current;

    if (!input) {
      commitMarkdown(session, `${session.markdown}${session.markdown ? "\n\n" : ""}${snippet}`);
      dispatch({ type: "version-diverged" });

      return;
    }

    const start = input.selectionStart ?? session.markdown.length;
    const end = input.selectionEnd ?? session.markdown.length;

    commitMarkdown(
      session,
      `${session.markdown.slice(0, start)}${snippet}${session.markdown.slice(end)}`,
    );
    dispatch({ type: "version-diverged" });
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
        dispatch({
          type: "error",
          error: error instanceof Error ? error.message : t("guide.imageInsertFailed"),
        });
      }
    }
  }

  async function copyMarkdown(): Promise<void> {
    const session = sessionRef.current;

    if (!session?.active) return;

    const operation = ++session.copying;
    const revision = session.revision;

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
          const html = renderMarkdownToHtml(session.markdown);
          const textBlob = new Blob([session.markdown], { type: "text/plain" });
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
        await navigator.clipboard.writeText(session.markdown);
      }

      if (!session.active || session.copying !== operation || session.revision !== revision) return;

      dispatch({ type: "copied", copied: true });
      session.copiedTimer = setTimeout(() => dispatch({ type: "copied", copied: false }), 2_000);
    } catch (error) {
      if (session.active && session.copying === operation && session.revision === revision) {
        dispatch({
          type: "error",
          error: error instanceof Error ? error.message : t("guide.copyFailed"),
        });
      }
    }
  }

  async function exportMarkdown(): Promise<void> {
    const session = sessionRef.current;

    if (!recording || !session?.active || session.exporting) return;

    session.exporting = true;
    dispatch({ type: "pending", operation: "exporting", pending: true });

    try {
      const desktop = getDesktopApi();

      if (desktop) {
        await desktop.guides.exportMarkdown({
          suggestedName: recording.title,
          markdown: session.markdown,
        });
      } else {
        downloadMarkdown(recording.title, session.markdown);
      }
    } catch (error) {
      if (session.active) {
        dispatch({
          type: "error",
          error: error instanceof Error ? error.message : t("guide.exportFailed"),
        });
      }
    } finally {
      session.exporting = false;
      if (session.active) dispatch({ type: "pending", operation: "exporting", pending: false });
    }
  }

  async function saveDocument(): Promise<boolean> {
    const session = sessionRef.current;
    const desktop = getDesktopApi();

    if (!recording || !desktop || !session?.active || session.saving) return false;

    const savedMarkdown = session.markdown;

    session.saving = true;
    dispatch({ type: "pending", operation: "saving", pending: true });

    try {
      const saved = await desktop.guides.saveDocument({
        id: recording.id,
        markdown: savedMarkdown,
      });

      // The saved text is authoritative even when the user kept typing during the write.
      if (session.active && session.recordingId === recording.id) {
        dispatch({ type: "saved", markdown: saved.markdown });
      }

      return true;
    } catch (error) {
      if (session.active) {
        dispatch({
          type: "error",
          error: error instanceof Error ? error.message : t("guide.saveFailed"),
        });
      }

      return false;
    } finally {
      session.saving = false;
      if (session.active) dispatch({ type: "pending", operation: "saving", pending: false });
    }
  }

  async function generateGuide(instructions: string): Promise<void> {
    const session = sessionRef.current;
    const desktop = getDesktopApi();

    if (!recording || !desktop || !session?.active || session.generating || session.updating) {
      return;
    }

    const revision = session.revision;

    session.generating = true;
    dispatch({ type: "pending", operation: "generating", pending: true });

    try {
      const generated = await desktop.guides.generate({ id: recording.id, instructions });

      if (session.active && session.revision === revision) {
        commitVersion(session, generated.markdown);
      }
    } catch (error) {
      if (session.active && session.revision === revision) {
        dispatch({
          type: "error",
          error: error instanceof Error ? error.message : t("guide.generateFailed"),
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
      session.updating
    ) {
      return false;
    }

    const revision = session.revision;
    const currentMarkdown = session.markdown;

    session.updating = true;
    dispatch({ type: "pending", operation: "updating", pending: true });

    try {
      const updated = await desktop.guides.update({
        id: recording.id,
        instructions,
        currentMarkdown,
        updatePrompt: request,
        ...(context?.length ? { context } : {}),
      });

      if (session.active && session.revision === revision) {
        commitVersion(session, updated.markdown);
      }

      return true;
    } catch (error) {
      // Updates are retried by sending a new chat prompt, never by regenerating the flow.
      if (session.active && session.revision === revision) {
        dispatch({
          type: "error",
          error: error instanceof Error ? error.message : t("guide.updateFailed"),
        });
      }

      return false;
    } finally {
      session.updating = false;
      if (session.active) dispatch({ type: "pending", operation: "updating", pending: false });
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
    generateGuide,
    updateGuide,
    selectVersion,
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
