import { vi } from "vitest";
import type {
  DesktopApi,
  DocumentRevision,
  DocumentRevisionKind,
  GuideDocumentChange,
  GuideDocumentSnapshot,
} from "@path/shared";

/**
 * In-memory stand-in for the desktop document store with the same concurrency rules: drafts are
 * checked by draft version, saves by saved revision, and history is append-only with
 * unchanged content deduplicated. Desktop tests cover the real repository.
 */
export function createGuideDocumentStore(recordingId: string) {
  const state = {
    savedRevisionNumber: null as number | null,
    savedAt: null as string | null,
    draft: null as string | null,
    draftVersion: 0,
    revisions: [] as DocumentRevision[],
  };

  const changeListeners = new Set<(change: GuideDocumentChange) => void>();
  const flushListeners = new Set<() => Promise<void>>();

  function latest(): DocumentRevision | undefined {
    return state.revisions.at(-1);
  }

  function append(
    kind: DocumentRevisionKind,
    markdown: string,
    restoredFromNumber: number | null = null,
  ): DocumentRevision {
    const previous = latest();

    if (previous?.markdown === markdown) return previous;

    const revision: DocumentRevision = {
      number: (previous?.number ?? 0) + 1,
      kind,
      markdown,
      createdAt: new Date(Date.UTC(2026, 8, 20, 10, state.revisions.length)).toISOString(),
      characterCount: markdown.length,
      restoredFromNumber,
    };

    state.revisions.push(revision);

    return revision;
  }

  function checkpoint(replaced?: string): void {
    if (replaced?.trim() && !state.revisions.some((revision) => revision.markdown === replaced)) {
      append("checkpoint", replaced);
    }
  }

  function savedMarkdown(): string {
    return (
      state.revisions.find((revision) => revision.number === state.savedRevisionNumber)?.markdown ??
      ""
    );
  }

  function summary({ markdown: _markdown, ...rest }: DocumentRevision) {
    return rest;
  }

  function snapshot(): GuideDocumentSnapshot {
    return {
      recordingId,
      saved:
        state.savedRevisionNumber !== null && state.savedAt
          ? {
              revisionNumber: state.savedRevisionNumber,
              markdown: savedMarkdown(),
              savedAt: state.savedAt,
            }
          : null,
      draft: state.draft === null ? null : { markdown: state.draft, updatedAt: "" },
      draftVersion: state.draftVersion,
      latestRevisionNumber: latest()?.number ?? null,
    };
  }

  /** Commits an AI result the way the desktop service does before returning it. */
  function commit(kind: "generated" | "ai-update", markdown: string, replaced?: string) {
    checkpoint(replaced);

    const revision = append(kind, markdown);

    return { markdown, revision: summary(revision) };
  }

  const guides: DesktopApi["guides"] = {
    generate: vi.fn(async (input) => commit("generated", `# Generated`, input.replacedMarkdown)),
    update: vi.fn(async (input) => commit("ai-update", "# Updated", input.currentMarkdown)),
    exportMarkdown: vi.fn(async () => true),
    getDocument: vi.fn(async () => structuredClone(snapshot())),
    saveDraft: vi.fn(async ({ markdown, expectedDraftVersion }) => {
      if (expectedDraftVersion !== state.draftVersion) {
        return { status: "conflict" as const, draftVersion: state.draftVersion };
      }

      state.draft = markdown === savedMarkdown() ? null : markdown;
      state.draftVersion += 1;

      return {
        status: "stored" as const,
        draftVersion: state.draftVersion,
        hasDraft: state.draft !== null,
      };
    }),
    discardDraft: vi.fn(async ({ expectedDraftVersion }) => {
      if (expectedDraftVersion !== state.draftVersion) {
        return { status: "conflict" as const, draftVersion: state.draftVersion };
      }

      state.draft = null;
      state.draftVersion += 1;

      return { status: "stored" as const, draftVersion: state.draftVersion, hasDraft: false };
    }),
    saveDocument: vi.fn(async ({ markdown, expectedSavedRevisionNumber, draftVersion }) => {
      if (expectedSavedRevisionNumber !== state.savedRevisionNumber) {
        return { status: "conflict" as const, savedRevisionNumber: state.savedRevisionNumber };
      }

      const revision = append("saved", markdown);

      state.savedRevisionNumber = revision.number;
      state.savedAt = "2026-09-20T12:00:00.000Z";

      if (draftVersion === state.draftVersion) {
        state.draft = null;
        state.draftVersion += 1;
      }

      return {
        status: "saved" as const,
        revision: summary(revision),
        savedAt: state.savedAt,
        draftVersion: state.draftVersion,
      };
    }),
    listRevisions: vi.fn(async ({ beforeNumber, limit = 50 }) => {
      const older = state.revisions
        .filter((revision) => beforeNumber === undefined || revision.number < beforeNumber)
        .reverse();

      return { revisions: older.slice(0, limit).map(summary), hasMore: older.length > limit };
    }),
    getRevision: vi.fn(async ({ number }) => {
      const revision = state.revisions.find((candidate) => candidate.number === number);

      if (!revision) throw new Error("Document revision not found");

      return structuredClone(revision);
    }),
    restoreRevision: vi.fn(async ({ number, replacedMarkdown }) => {
      const source = state.revisions.find((candidate) => candidate.number === number);

      if (!source) throw new Error("Document revision not found");

      checkpoint(replacedMarkdown);

      return {
        markdown: source.markdown,
        revision: summary(append("restored", source.markdown, number)),
      };
    }),
    onChanged: vi.fn((listener) => {
      changeListeners.add(listener);

      return () => changeListeners.delete(listener);
    }),
  };

  const app = {
    onFlushRequested: vi.fn((listener: () => Promise<void>) => {
      flushListeners.add(listener);

      return () => flushListeners.delete(listener);
    }),
  };

  return {
    state,
    guides,
    app,
    append,
    /** What main does before quitting: waits for every registered flush. */
    requestFlush: () => Promise.all([...flushListeners].map((flush) => flush())),
    /** Simulates another window's committed change reaching this one. */
    broadcast: () =>
      changeListeners.forEach((listener) =>
        listener({
          recordingId,
          draftVersion: state.draftVersion,
          savedRevisionNumber: state.savedRevisionNumber,
          latestRevisionNumber: latest()?.number ?? null,
        }),
      ),
  };
}

export type GuideDocumentStore = ReturnType<typeof createGuideDocumentStore>;
