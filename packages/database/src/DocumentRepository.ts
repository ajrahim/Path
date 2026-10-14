import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, lt, max } from "drizzle-orm";
import type {
  CommittedGuideCollection,
  CommittedGuideRevision,
  DocumentGenerationMode,
  DocumentRevision,
  DocumentRevisionKind,
  DocumentRevisionPage,
  DocumentRevisionSummary,
  DocumentWorkflow,
  GuideDocumentChange,
  GuideDocumentCollection,
  GuideDocumentSnapshot,
  GuideDocumentSummary,
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
import {
  documentCollections,
  documentDrafts,
  documentImages,
  documentRevisions,
  documents,
  recordings,
} from "./Schema";

type Transaction = Parameters<Parameters<PathDatabase["transaction"]>[0]>[0];
type CollectionRow = typeof documentCollections.$inferSelect;
type DocumentRow = typeof documents.$inferSelect;
type RevisionRow = typeof documentRevisions.$inferSelect;

interface CollectionResult {
  title: string;
  markdown: string;
  documentId?: string;
}

interface CollectionWorkflowPlan {
  workflows: DocumentWorkflow[];
  expectedPlanVersion: number;
}

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

function assertValidCollectionCommit(
  results: CollectionResult[],
  mode: DocumentGenerationMode,
  workflowPlan?: CollectionWorkflowPlan,
): void {
  if (
    !results.length ||
    results.some((result) => !result.title.trim() || !result.markdown.trim())
  ) {
    throw new Error("The model returned an incomplete document collection");
  }

  const titles = results.map((result) => result.title.trim().toLowerCase());

  if (new Set(titles).size !== titles.length) throw new Error("Duplicate document titles");

  if (workflowPlan && !matchesWorkflowPlan(results, mode, workflowPlan)) {
    throw new Error("Generated documents do not match the workflow plan");
  }
}

function matchesWorkflowPlan(
  results: CollectionResult[],
  mode: DocumentGenerationMode,
  workflowPlan: CollectionWorkflowPlan,
): boolean {
  if (mode !== "split" || workflowPlan.workflows.length !== results.length) return false;

  return results.every(
    (result, index) =>
      result.documentId === workflowPlan.workflows[index]?.id &&
      result.title.trim() === workflowPlan.workflows[index]?.title.trim(),
  );
}

/**
 * A generated document keeps its previous history when it replaces a stored one. Combine
 * generation reuses a non-plan document with the same title; split generation reuses the
 * planned document identity, falling back to a title match.
 */
function findPreviousCollectionDocument(
  storedDocuments: DocumentRow[],
  result: CollectionResult,
  mode: DocumentGenerationMode,
  planIds: Set<string>,
): DocumentRow | undefined {
  if (mode === "combine") {
    return storedDocuments.find(
      (member) => !planIds.has(member.id) && member.title === result.title,
    );
  }

  return storedDocuments.find((member) =>
    result.documentId
      ? member.id === result.documentId
      : member.title.toLowerCase() === result.title.trim().toLowerCase(),
  );
}

/**
 * Owns guide documents, their append-only revision history, and recovery drafts. Each method is
 * one transaction in the database worker, so concurrency checks and writes cannot interleave.
 */
export class DocumentRepository {
  constructor(private readonly db: PathDatabase) {}

  getCollection(
    recordingId: string,
    tx: Transaction | PathDatabase = this.db,
  ): GuideDocumentCollection {
    const collection = tx
      .select()
      .from(documentCollections)
      .where(eq(documentCollections.recordingId, recordingId))
      .get();

    const stored = tx
      .select({ id: documents.id, title: documents.title, position: documents.position })
      .from(documents)
      .where(eq(documents.recordingId, recordingId))
      .orderBy(asc(documents.position))
      .all();

    const storedIds = new Set(stored.map((document) => document.id));
    const members = stored
      .filter((document) => document.position !== null)
      .map(({ id, title }) => ({ id, title }));

    return {
      recordingId,
      mode: collection?.mode ?? "combine",
      documents: members,
      workflows:
        collection?.workflowPlan?.map((workflow) => ({
          ...workflow,
          documentId: storedIds.has(workflow.id) ? workflow.id : undefined,
        })) ?? null,
      planVersion: collection?.planVersion ?? 0,
    };
  }

  saveWorkflowPlan(
    recordingId: string,
    workflows: DocumentWorkflow[],
    expectedPlanVersion: number,
  ): GuideDocumentCollection {
    return this.db.transaction((tx) => {
      tx.insert(documentCollections).values({ recordingId }).onConflictDoNothing().run();
      this.updateWorkflowPlan(
        tx,
        recordingId,
        workflows,
        expectedPlanVersion,
        "The split plan changed in another window. Reload before editing it.",
      );

      return this.getCollection(recordingId, tx);
    });
  }

  setGenerationMode(recordingId: string, mode: DocumentGenerationMode): GuideDocumentCollection {
    this.db
      .insert(documentCollections)
      .values({ recordingId, mode })
      .onConflictDoUpdate({
        target: documentCollections.recordingId,
        set: { mode },
      })
      .run();

    return this.getCollection(recordingId);
  }

  commitCollection(
    recordingId: string,
    results: CollectionResult[],
    replacedMarkdown?: string,
    replacedDocumentId?: string,
    mode: DocumentGenerationMode = "split",
    workflowPlan?: CollectionWorkflowPlan,
  ): CommittedGuideCollection {
    assertValidCollectionCommit(results, mode, workflowPlan);

    return this.db.transaction((tx) => {
      tx.insert(documentCollections)
        .values({ recordingId, mode })
        .onConflictDoUpdate({ target: documentCollections.recordingId, set: { mode } })
        .run();

      if (workflowPlan) {
        this.updateWorkflowPlan(
          tx,
          recordingId,
          workflowPlan.workflows,
          workflowPlan.expectedPlanVersion,
          "The split plan changed in another window. Retry generation.",
        );
      }

      const existing = tx
        .select()
        .from(documents)
        .where(and(eq(documents.recordingId, recordingId), isNotNull(documents.position)))
        .orderBy(asc(documents.position))
        .all();

      if (replacedMarkdown) {
        const replaced = this.ensureDocument(tx, recordingId, replacedDocumentId);

        this.checkpoint(tx, replaced, replacedMarkdown);
      }

      this.checkpointDrafts(tx, existing);

      // Documents leaving the collection keep their rows and history; they only lose a position.
      tx.update(documents)
        .set({ position: null })
        .where(eq(documents.recordingId, recordingId))
        .run();

      const storedDocuments = tx
        .select()
        .from(documents)
        .where(eq(documents.recordingId, recordingId))
        .all();

      const planIds = new Set(
        this.getCollection(recordingId, tx).workflows?.map((workflow) => workflow.id),
      );

      const committed = results.map((result, position) =>
        this.commitGeneratedDocument(
          tx,
          recordingId,
          result,
          position,
          mode,
          storedDocuments,
          planIds,
        ),
      );

      return {
        ...this.getCollection(recordingId, tx),
        documents: committed.map((entry) => entry.member),
        generated: committed.map((entry) => entry.generated),
      };
    });
  }

  /** Unsaved drafts are kept in history before a generation replaces them. */
  private checkpointDrafts(tx: Transaction, documentRows: DocumentRow[]): void {
    for (const document of documentRows) {
      const draft = tx
        .select()
        .from(documentDrafts)
        .where(eq(documentDrafts.documentId, document.id))
        .get();

      this.checkpoint(tx, document, draft?.markdown);
    }
  }

  private commitGeneratedDocument(
    tx: Transaction,
    recordingId: string,
    result: CollectionResult,
    position: number,
    mode: DocumentGenerationMode,
    storedDocuments: DocumentRow[],
    planIds: Set<string>,
  ): {
    member: GuideDocumentSummary;
    generated: CommittedGuideCollection["generated"][number];
  } {
    const title = result.title.trim();
    const previous = findPreviousCollectionDocument(storedDocuments, result, mode, planIds);
    const now = new Date().toISOString();

    const document =
      previous ??
      tx
        .insert(documents)
        .values({
          id: result.documentId ?? randomUUID(),
          recordingId,
          title,
          position,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();

    if (previous) {
      tx.update(documents).set({ title, position }).where(eq(documents.id, document.id)).run();
    }

    this.checkpointDrafts(tx, [document]);
    const revision = this.appendRevision(tx, document, "generated", result.markdown);

    tx.insert(documentDrafts)
      .values({ documentId: document.id, markdown: result.markdown, updatedAt: now })
      .onConflictDoUpdate({
        target: documentDrafts.documentId,
        set: { markdown: result.markdown, updatedAt: now },
      })
      .run();
    this.advanceDraftVersion(tx, document, now);

    return {
      member: { id: document.id, title },
      generated: {
        documentId: document.id,
        markdown: result.markdown,
        revision: toSummary(revision),
      },
    };
  }

  /** Replaces the plan only when the caller still holds the current plan version. */
  private updateWorkflowPlan(
    tx: Transaction,
    recordingId: string,
    workflows: DocumentWorkflow[],
    expectedPlanVersion: number,
    conflictMessage: string,
  ): void {
    const current = this.requireCollection(tx, recordingId);

    if (current.planVersion !== expectedPlanVersion) throw new Error(conflictMessage);

    tx.update(documentCollections)
      .set({ workflowPlan: workflows, planVersion: current.planVersion + 1 })
      .where(eq(documentCollections.recordingId, recordingId))
      .run();
  }

  private requireCollection(tx: Transaction, recordingId: string): CollectionRow {
    const collection = tx
      .select()
      .from(documentCollections)
      .where(eq(documentCollections.recordingId, recordingId))
      .get();

    if (!collection) {
      throw new Error(`No document collection exists for recording: ${recordingId}`);
    }

    return collection;
  }

  getSnapshot(recordingId: string, documentId?: string): GuideDocumentSnapshot {
    const document = this.findDocument(this.db, recordingId, documentId);

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
  getChange(recordingId: string, documentId?: string): GuideDocumentChange {
    const document = this.findDocument(this.db, recordingId, documentId);

    return {
      recordingId,
      ...(documentId ? { documentId } : {}),
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
    documentId?: string,
  ): DocumentRevisionPage {
    const document = this.findDocument(this.db, recordingId, documentId);

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

  getRevision(recordingId: string, number: number, documentId?: string): DocumentRevision {
    const document = this.requireDocument(this.db, recordingId, documentId);
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
    documentId?: string,
  ): SaveGuideDraftResult {
    return this.db.transaction((tx) => {
      const document = this.ensureDocument(tx, recordingId, documentId);

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

  discardDraft(
    recordingId: string,
    expectedDraftVersion: number,
    documentId?: string,
  ): SaveGuideDraftResult {
    return this.db.transaction((tx) => {
      const document = this.findDocument(tx, recordingId, documentId);

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
    documentId?: string,
  ): SaveGuideDocumentResult {
    return this.db.transaction((tx) => {
      const document = this.ensureDocument(tx, recordingId, documentId);

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
    documentId?: string,
  ): CommittedGuideRevision {
    return this.db.transaction((tx) => {
      const document = this.ensureDocument(tx, recordingId, documentId);

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
    documentId?: string,
  ): CommittedGuideRevision {
    return this.db.transaction((tx) => {
      const document = this.requireDocument(tx, recordingId, documentId);
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

  private findDocument(
    tx: Transaction | PathDatabase,
    recordingId: string,
    documentId?: string,
  ): DocumentRow | null {
    return (
      tx
        .select()
        .from(documents)
        .where(
          and(
            eq(documents.recordingId, recordingId),
            documentId ? eq(documents.id, documentId) : isNotNull(documents.position),
          ),
        )
        .orderBy(asc(documents.position))
        .get() ?? null
    );
  }

  private requireDocument(
    tx: Transaction | PathDatabase,
    recordingId: string,
    documentId?: string,
  ): DocumentRow {
    const document = this.findDocument(tx, recordingId, documentId);

    if (!document) {
      throw new RecordNotFoundError(
        documentId
          ? `Document not found: ${documentId}`
          : `No document exists for recording: ${recordingId}`,
      );
    }

    return document;
  }

  private ensureDocument(tx: Transaction, recordingId: string, documentId?: string): DocumentRow {
    const existing = this.findDocument(tx, recordingId, documentId);

    if (existing) return existing;

    if (documentId) {
      throw new RecordNotFoundError(`Document not found: ${documentId}`);
    }

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
