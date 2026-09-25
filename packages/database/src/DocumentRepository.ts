import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, lt, max } from "drizzle-orm";
import type {
  CommittedGuideRevision,
  DocumentRevision,
  DocumentRevisionKind,
  DocumentRevisionPage,
  DocumentRevisionSummary,
  GuideDocumentChange,
  GuideDocumentSnapshot,
  SaveGuideDocumentResult,
  SaveGuideDraftResult,
} from "@path/shared";
import type { PathDatabase } from "./Connection";
import { RecordNotFoundError } from "./DatabaseErrors";
import {
  decodeDocumentBody,
  encodeDocumentBody,
  hashContent,
  referencedImageHashes,
} from "./DocumentContent";
import { documentDrafts, documentImages, documentRevisions, documents, recordings } from "./Schema";

type Transaction = Parameters<Parameters<PathDatabase["transaction"]>[0]>[0];
type DocumentRow = typeof documents.$inferSelect;
type RevisionRow = typeof documentRevisions.$inferSelect;

const DEFAULT_REVISION_PAGE_SIZE = 50;

function toSummary(row: RevisionRow): DocumentRevisionSummary {
  return {
    number: row.number,
    kind: row.kind,
    createdAt: row.createdAt,
    characterCount: row.characterCount,
    restoredFromNumber: row.restoredFromNumber,
  };
}

/**
 * Owns guide documents, their append-only revision history, and recovery drafts. Each method is
 * one transaction in the database worker, so concurrency checks and writes cannot interleave.
 */
export class DocumentRepository {
  constructor(private readonly db: PathDatabase) {}

  getSnapshot(recordingId: string): GuideDocumentSnapshot {
    const document = this.findDocument(this.db, recordingId);

    if (!document) {
      return { recordingId, saved: null, draft: null, draftVersion: 0, latestRevisionNumber: null };
    }

    const savedRevision =
      document.savedRevisionNumber === null
        ? null
        : this.requireRevision(this.db, document.id, document.savedRevisionNumber);

    const draft = this.db
      .select({ markdown: documentDrafts.markdown, updatedAt: documentDrafts.updatedAt })
      .from(documentDrafts)
      .where(eq(documentDrafts.documentId, document.id))
      .get();

    return {
      recordingId,
      saved:
        savedRevision && document.savedAt
          ? {
              revisionNumber: savedRevision.number,
              markdown: this.decode(this.db, savedRevision),
              savedAt: document.savedAt,
            }
          : null,
      draft: draft ?? null,
      draftVersion: document.draftVersion,
      latestRevisionNumber: this.latestRevision(this.db, document.id)?.number ?? null,
    };
  }

  /** Concurrency tokens other windows compare against their own view of the document. */
  getChange(recordingId: string): GuideDocumentChange {
    const document = this.findDocument(this.db, recordingId);

    return {
      recordingId,
      draftVersion: document?.draftVersion ?? 0,
      savedRevisionNumber: document?.savedRevisionNumber ?? null,
      latestRevisionNumber: document
        ? (this.latestRevision(this.db, document.id)?.number ?? null)
        : null,
    };
  }

  listRevisions(
    recordingId: string,
    beforeNumber?: number,
    limit = DEFAULT_REVISION_PAGE_SIZE,
  ): DocumentRevisionPage {
    const document = this.findDocument(this.db, recordingId);

    if (!document) return { revisions: [], hasMore: false };

    const rows = this.db
      .select()
      .from(documentRevisions)
      .where(
        beforeNumber === undefined
          ? eq(documentRevisions.documentId, document.id)
          : and(
              eq(documentRevisions.documentId, document.id),
              lt(documentRevisions.number, beforeNumber),
            ),
      )
      .orderBy(desc(documentRevisions.number))
      .limit(limit + 1)
      .all();

    return { revisions: rows.slice(0, limit).map(toSummary), hasMore: rows.length > limit };
  }

  getRevision(recordingId: string, number: number): DocumentRevision {
    const document = this.requireDocument(this.db, recordingId);
    const revision = this.requireRevision(this.db, document.id, number);

    return { ...toSummary(revision), markdown: this.decode(this.db, revision) };
  }

  /**
   * Store unsaved editor text. Text equal to the saved revision removes the draft instead, so a
   * draft exists only while there are unsaved changes.
   */
  saveDraft(
    recordingId: string,
    markdown: string,
    expectedDraftVersion: number,
  ): SaveGuideDraftResult {
    return this.db.transaction((tx) => {
      const document = this.ensureDocument(tx, recordingId);

      if (document.draftVersion !== expectedDraftVersion) {
        return { status: "conflict", draftVersion: document.draftVersion };
      }

      const now = new Date().toISOString();
      const hasDraft = !this.matchesSavedContent(tx, document, markdown);

      if (hasDraft) {
        tx.insert(documentDrafts)
          .values({ documentId: document.id, markdown, updatedAt: now })
          .onConflictDoUpdate({
            target: documentDrafts.documentId,
            set: { markdown, updatedAt: now },
          })
          .run();
      } else {
        tx.delete(documentDrafts).where(eq(documentDrafts.documentId, document.id)).run();
      }

      const draftVersion = this.advanceDraftVersion(tx, document, now);

      return { status: "stored", draftVersion, hasDraft };
    });
  }

  discardDraft(recordingId: string, expectedDraftVersion: number): SaveGuideDraftResult {
    return this.db.transaction((tx) => {
      const document = this.findDocument(tx, recordingId);

      if (!document) return { status: "stored", draftVersion: 0, hasDraft: false };

      if (document.draftVersion !== expectedDraftVersion) {
        return { status: "conflict", draftVersion: document.draftVersion };
      }

      tx.delete(documentDrafts).where(eq(documentDrafts.documentId, document.id)).run();

      const draftVersion = this.advanceDraftVersion(tx, document, new Date().toISOString());

      return { status: "stored", draftVersion, hasDraft: false };
    });
  }

  /**
   * Explicit save. It is rejected when another editor saved after this one loaded the saved
   * revision. Content identical to the latest revision reuses it instead of duplicating history.
   * The draft is cleared only when no newer draft was written after the one being saved.
   */
  save(
    recordingId: string,
    markdown: string,
    expectedSavedRevisionNumber: number | null,
    expectedDraftVersion: number,
  ): SaveGuideDocumentResult {
    return this.db.transaction((tx) => {
      const document = this.ensureDocument(tx, recordingId);

      if (document.savedRevisionNumber !== expectedSavedRevisionNumber) {
        return { status: "conflict", savedRevisionNumber: document.savedRevisionNumber };
      }

      const revision = this.appendRevision(tx, document, "saved", markdown);
      const savedAt = new Date().toISOString();
      let draftVersion = document.draftVersion;

      tx.update(documents)
        .set({ savedRevisionNumber: revision.number, savedAt, updatedAt: savedAt })
        .where(eq(documents.id, document.id))
        .run();

      if (document.draftVersion === expectedDraftVersion) {
        tx.delete(documentDrafts).where(eq(documentDrafts.documentId, document.id)).run();
        draftVersion = this.advanceDraftVersion(tx, document, savedAt);
      }

      return { status: "saved", revision: toSummary(revision), savedAt, draftVersion };
    });
  }

  /**
   * Commit an AI result before any editor shows it. Unsaved text it replaces is checkpointed
   * first when history does not already contain it. Neither the save nor the draft changes.
   */
  commitRevision(
    recordingId: string,
    kind: Extract<DocumentRevisionKind, "generated" | "ai-update">,
    markdown: string,
    replacedMarkdown?: string,
  ): CommittedGuideRevision {
    return this.db.transaction((tx) => {
      const document = this.ensureDocument(tx, recordingId);

      this.checkpoint(tx, document, replacedMarkdown);

      const revision = this.appendRevision(tx, document, kind, markdown);

      return { markdown, revision: toSummary(revision) };
    });
  }

  /** Restoring appends the earlier content as a new revision; no history is removed. */
  restoreRevision(
    recordingId: string,
    number: number,
    replacedMarkdown?: string,
  ): CommittedGuideRevision {
    return this.db.transaction((tx) => {
      const document = this.requireDocument(tx, recordingId);
      const source = this.requireRevision(tx, document.id, number);
      const markdown = this.decode(tx, source);

      this.checkpoint(tx, document, replacedMarkdown);

      const revision = this.appendRevision(tx, document, "restored", markdown, number);

      return { markdown, revision: toSummary(revision) };
    });
  }

  private checkpoint(tx: Transaction, document: DocumentRow, replacedMarkdown?: string): void {
    if (!replacedMarkdown?.trim()) return;

    const isInHistory = tx
      .select({ number: documentRevisions.number })
      .from(documentRevisions)
      .where(
        and(
          eq(documentRevisions.documentId, document.id),
          eq(documentRevisions.contentHash, hashContent(replacedMarkdown)),
        ),
      )
      .get();

    if (!isInHistory) this.appendRevision(tx, document, "checkpoint", replacedMarkdown);
  }

  /** Unchanged content returns the latest revision instead of creating a duplicate. */
  private appendRevision(
    tx: Transaction,
    document: DocumentRow,
    kind: DocumentRevisionKind,
    markdown: string,
    restoredFromNumber: number | null = null,
  ): RevisionRow {
    const contentHash = hashContent(markdown);
    const latest = this.latestRevision(tx, document.id);

    if (latest?.contentHash === contentHash) return latest;

    const encoded = encodeDocumentBody(markdown);
    const now = new Date().toISOString();

    if (encoded.images.length > 0) {
      tx.insert(documentImages)
        .values(encoded.images.map((image) => ({ documentId: document.id, ...image })))
        .onConflictDoNothing()
        .run();
    }

    const revision = tx
      .insert(documentRevisions)
      .values({
        documentId: document.id,
        number: (latest?.number ?? 0) + 1,
        kind,
        contentHash,
        body: encoded.body,
        bodyEncoding: encoded.encoding,
        characterCount: markdown.length,
        restoredFromNumber,
        createdAt: now,
      })
      .returning()
      .get();

    tx.update(documents).set({ updatedAt: now }).where(eq(documents.id, document.id)).run();

    return revision;
  }

  private matchesSavedContent(tx: Transaction, document: DocumentRow, markdown: string): boolean {
    if (document.savedRevisionNumber === null) return markdown === "";

    const saved = this.requireRevision(tx, document.id, document.savedRevisionNumber);

    return saved.contentHash === hashContent(markdown);
  }

  private advanceDraftVersion(tx: Transaction, document: DocumentRow, now: string): number {
    const draftVersion = document.draftVersion + 1;

    tx.update(documents)
      .set({ draftVersion, updatedAt: now })
      .where(eq(documents.id, document.id))
      .run();

    return draftVersion;
  }

  private decode(tx: Transaction | PathDatabase, revision: RevisionRow): string {
    const hashes = referencedImageHashes(revision.body, revision.bodyEncoding);
    const images =
      hashes.length === 0
        ? []
        : tx
            .select({ hash: documentImages.hash, dataUrl: documentImages.dataUrl })
            .from(documentImages)
            .where(
              and(
                eq(documentImages.documentId, revision.documentId),
                inArray(documentImages.hash, hashes),
              ),
            )
            .all();

    return decodeDocumentBody(
      revision.body,
      revision.bodyEncoding,
      new Map(images.map((image) => [image.hash, image.dataUrl])),
    );
  }

  private latestRevision(tx: Transaction | PathDatabase, documentId: string): RevisionRow | null {
    const latest = tx
      .select({ number: max(documentRevisions.number) })
      .from(documentRevisions)
      .where(eq(documentRevisions.documentId, documentId))
      .get();

    if (latest?.number === null || latest?.number === undefined) return null;

    return this.requireRevision(tx, documentId, latest.number);
  }

  private requireRevision(
    tx: Transaction | PathDatabase,
    documentId: string,
    number: number,
  ): RevisionRow {
    const revision = tx
      .select()
      .from(documentRevisions)
      .where(
        and(eq(documentRevisions.documentId, documentId), eq(documentRevisions.number, number)),
      )
      .get();

    if (!revision) throw new RecordNotFoundError(`Document revision not found: ${number}`);

    return revision;
  }

  private findDocument(tx: Transaction | PathDatabase, recordingId: string): DocumentRow | null {
    return tx.select().from(documents).where(eq(documents.recordingId, recordingId)).get() ?? null;
  }

  private requireDocument(tx: Transaction | PathDatabase, recordingId: string): DocumentRow {
    const document = this.findDocument(tx, recordingId);

    if (!document) {
      throw new RecordNotFoundError(`No document exists for recording: ${recordingId}`);
    }

    return document;
  }

  private ensureDocument(tx: Transaction, recordingId: string): DocumentRow {
    const existing = this.findDocument(tx, recordingId);

    if (existing) return existing;

    const recording = tx
      .select({ id: recordings.id })
      .from(recordings)
      .where(eq(recordings.id, recordingId))
      .get();

    if (!recording) throw new RecordNotFoundError(`Recording not found: ${recordingId}`);

    const now = new Date().toISOString();

    return tx
      .insert(documents)
      .values({ id: randomUUID(), recordingId, draftVersion: 0, createdAt: now, updatedAt: now })
      .returning()
      .get();
  }
}
