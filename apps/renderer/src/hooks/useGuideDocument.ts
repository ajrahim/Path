import { useEffect, useReducer, useRef, type RefObject } from "react";
import { useTranslations } from "next-intl";
import type { RecordingSummary } from "@path/shared";
import { getDesktopApi } from "@/lib/Desktop";

interface DocumentState {
  markdown: string;
  generating: boolean;
  exporting: boolean;
  copied: boolean;
  error: string | null;
}

const EMPTY_DOCUMENT: DocumentState = {
  markdown: "",
  generating: false,
  exporting: false,
  copied: false,
  error: null,
};

type DocumentAction =
  | { type: "reset" }
  | { type: "edited"; markdown: string }
  | { type: "pending"; operation: "generating" | "exporting"; pending: boolean }
  | { type: "copied"; copied: boolean }
  | { type: "error"; error: string | null };

// Editing invalidates copy confirmation while each asynchronous operation retains its own status.
function reduceDocument(state: DocumentState, action: DocumentAction): DocumentState {
  switch (action.type) {
    case "reset":
      return EMPTY_DOCUMENT;

    case "edited":
      return { ...state, markdown: action.markdown, copied: false };

    case "pending":
      return {
        ...state,
        [action.operation]: action.pending,
        error: action.pending ? null : state.error,
      };

    case "copied":
      return { ...state, copied: action.copied };

    case "error":
      return { ...state, error: action.error };
  }
}

interface DocumentSession {
  active: boolean;
  markdown: string;
  revision: number;
  copying: number;
  generating: boolean;
  exporting: boolean;
  readers: Set<FileReader>;
  copiedTimer?: ReturnType<typeof setTimeout>;
  focusFrame?: number;
}

interface GuideDocument extends DocumentState {
  markdownInputRef: RefObject<HTMLTextAreaElement | null>;
  editMarkdown(markdown: string): void;
  insertImages(files: File[]): Promise<void>;
  copyMarkdown(): Promise<void>;
  exportMarkdown(): Promise<void>;
  generateGuide(instructions: string): Promise<void>;
}

/** Owns one recording's transient Markdown draft, pending operations, and browser resources. */
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
      markdown: "",
      revision: 0,
      copying: 0,
      generating: false,
      exporting: false,
      readers: new Set(),
    };

    sessionRef.current = session;
    dispatch({ type: "reset" });

    return () => {
      // IPC generation/export cannot be canceled. Invalidate their completions,
      // and actively release the browser resources that this recording owns.
      session.active = false;
      clearTimeout(session.copiedTimer);
      if (session.focusFrame !== undefined) cancelAnimationFrame(session.focusFrame);

      for (const reader of session.readers) reader.abort();
    };
  }, [recordingId]);

  function commitMarkdown(session: DocumentSession, markdown: string): void {
    session.markdown = markdown;
    session.revision += 1;
    clearTimeout(session.copiedTimer);
    dispatch({ type: "edited", markdown });
  }

  function editMarkdown(markdown: string): void {
    const session = sessionRef.current;

    if (session?.active) commitMarkdown(session, markdown);
  }

  async function insertImages(files: File[]): Promise<void> {
    const images = files.filter((file) => file.type.startsWith("image/"));
    const input = markdownInputRef.current;
    const session = sessionRef.current;

    if (!session?.active || !input || images.length === 0) return;

    const start = input.selectionStart;
    const end = input.selectionEnd;
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

          const alt = file.name.replace(/\.[^.]+$/, "").replace(/[\[\]]/g, "");

          return `![${alt || t("guide.imageAlt")}](${source})`;
        }),
      );

      // The captured selection belongs to this document revision. Never replace
      // edits made while FileReader was loading the images.
      if (!session.active || session.revision !== revision) return;

      const insertion = imageMarkdown.join("\n\n");

      commitMarkdown(
        session,
        `${session.markdown.slice(0, start)}${insertion}${session.markdown.slice(end)}`,
      );
      const insertedRevision = session.revision;

      if (session.focusFrame !== undefined) cancelAnimationFrame(session.focusFrame);

      session.focusFrame = requestAnimationFrame(() => {
        if (!session.active || session.revision !== insertedRevision) return;

        const cursor = start + insertion.length;

        input.focus();
        input.setSelectionRange(cursor, cursor);
      });
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
      await navigator.clipboard.writeText(session.markdown);
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

  async function generateGuide(instructions: string): Promise<void> {
    const session = sessionRef.current;
    const desktop = getDesktopApi();

    if (!recording || !desktop || !session?.active || session.generating) return;

    const revision = session.revision;

    session.generating = true;
    dispatch({ type: "pending", operation: "generating", pending: true });

    try {
      const generated = await desktop.guides.generate({ id: recording.id, instructions });

      if (session.active && session.revision === revision) {
        commitMarkdown(session, generated.markdown);
      }
    } catch (error) {
      if (session.active && session.revision === revision) {
        dispatch({
          type: "error",
          error: error instanceof Error ? error.message : t("guide.generateFailed"),
        });
      }
    } finally {
      session.generating = false;
      if (session.active) dispatch({ type: "pending", operation: "generating", pending: false });
    }
  }

  return {
    ...state,
    markdownInputRef,
    editMarkdown,
    insertImages,
    copyMarkdown,
    exportMarkdown,
    generateGuide,
  };
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
