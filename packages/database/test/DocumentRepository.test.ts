import { statSync } from "node:fs";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestRecording, openTestDatabase } from "./TestDatabase";

// A realistic embedded screenshot: large enough to be stored once per document.
const IMAGE = `data:image/png;base64,${"iVBORw0KGgoAAAANSUhEUgAA".repeat(4_000)}==`;

describe("DocumentRepository", () => {
  it("starts empty and keeps unsaved drafts separate from explicit saves", () => {
    const database = openTestDatabase();
    const recordingId = createTestRecording(database);

    expect(database.documents.getSnapshot(recordingId)).toEqual({
      recordingId,
      saved: null,
      draft: null,
      draftVersion: 0,
      latestRevisionNumber: null,
    });

    expect(database.documents.saveDraft(recordingId, "# Draft", 0)).toEqual({
      status: "stored",
      draftVersion: 1,
      hasDraft: true,
    });

    const snapshot = database.documents.getSnapshot(recordingId);

    // A recovery draft never counts as a save and creates no revision.
    expect(snapshot.saved).toBeNull();
    expect(snapshot.draft?.markdown).toBe("# Draft");
    expect(snapshot.latestRevisionNumber).toBeNull();

    const saved = database.documents.save(recordingId, "# Draft", null, 1);

    expect(saved).toMatchObject({
      status: "saved",
      revision: { number: 1, kind: "saved", characterCount: 7 },
      draftVersion: 2,
    });
    expect(database.documents.getSnapshot(recordingId)).toMatchObject({
      saved: { revisionNumber: 1, markdown: "# Draft" },
      draft: null,
      draftVersion: 2,
      latestRevisionNumber: 1,
    });

    // Typing back to the saved text removes the draft instead of storing a copy.
    expect(database.documents.saveDraft(recordingId, "# Draft", 2)).toMatchObject({
      hasDraft: false,
    });

    database.connection.close();
  });

  it("rejects stale draft and save requests without losing newer text", () => {
    const database = openTestDatabase();
    const recordingId = createTestRecording(database);

    database.documents.saveDraft(recordingId, "# Window A", 0);

    expect(database.documents.saveDraft(recordingId, "# Window B", 0)).toEqual({
      status: "conflict",
      draftVersion: 1,
    });
    expect(database.documents.getSnapshot(recordingId).draft?.markdown).toBe("# Window A");

    database.documents.save(recordingId, "# Saved by A", null, 1);

    expect(database.documents.save(recordingId, "# Saved by B", null, 1)).toEqual({
      status: "conflict",
      savedRevisionNumber: 1,
    });
    expect(database.documents.getSnapshot(recordingId).saved?.markdown).toBe("# Saved by A");

    // A deliberate save against the current revision succeeds; the earlier save stays in history.
    expect(database.documents.save(recordingId, "# Saved by B", 1, 2)).toMatchObject({
      status: "saved",
      revision: { number: 2 },
    });
    expect(database.documents.getRevision(recordingId, 1).markdown).toBe("# Saved by A");

    database.connection.close();
  });

  it("keeps a newer draft written while a save was in flight", () => {
    const database = openTestDatabase();
    const recordingId = createTestRecording(database);

    database.documents.saveDraft(recordingId, "# Being saved", 0);
    database.documents.saveDraft(recordingId, "# Typed after save started", 1);

    const saved = database.documents.save(recordingId, "# Being saved", null, 1);

    expect(saved).toMatchObject({ status: "saved", draftVersion: 2 });
    expect(database.documents.getSnapshot(recordingId).draft?.markdown).toBe(
      "# Typed after save started",
    );

    database.connection.close();
  });

  it("commits AI revisions, checkpoints replaced text, and never duplicates unchanged content", () => {
    const database = openTestDatabase();
    const recordingId = createTestRecording(database);

    const generated = database.documents.commitRevision(recordingId, "generated", "# Generated");

    expect(generated.revision).toMatchObject({ number: 1, kind: "generated" });

    // Hand edits being replaced by an update are checkpointed before the update lands.
    const updated = database.documents.commitRevision(
      recordingId,
      "ai-update",
      "# Updated",
      "# Generated\n\nHand edit",
    );

    expect(updated.revision).toMatchObject({ number: 3, kind: "ai-update" });
    expect(database.documents.listRevisions(recordingId).revisions.map((r) => r.kind)).toEqual([
      "ai-update",
      "checkpoint",
      "generated",
    ]);

    // Identical regeneration and replaced text already in history add nothing.
    const repeated = database.documents.commitRevision(
      recordingId,
      "generated",
      "# Updated",
      "# Generated",
    );

    expect(repeated.revision.number).toBe(3);

    // Saving content identical to the latest revision marks that revision saved.
    expect(database.documents.save(recordingId, "# Updated", null, 0)).toMatchObject({
      revision: { number: 3, kind: "ai-update" },
    });
    expect(database.documents.listRevisions(recordingId).revisions).toHaveLength(3);

    // The draft and saved revision are untouched by AI commits.
    database.documents.commitRevision(recordingId, "generated", "# Newer");

    expect(database.documents.getSnapshot(recordingId)).toMatchObject({
      saved: { revisionNumber: 3 },
      draft: null,
      latestRevisionNumber: 4,
    });

    database.connection.close();
  });

  it("restores an earlier revision as a new revision without removing history", () => {
    const database = openTestDatabase();
    const recordingId = createTestRecording(database);

    database.documents.commitRevision(recordingId, "generated", "# One");
    database.documents.commitRevision(recordingId, "generated", "# Two");

    const restored = database.documents.restoreRevision(recordingId, 1, "# Two\n\nUnsaved");

    expect(restored).toEqual({
      markdown: "# One",
      revision: expect.objectContaining({ number: 4, kind: "restored", restoredFromNumber: 1 }),
    });
    expect(
      database.documents.listRevisions(recordingId).revisions.map((revision) => revision.kind),
    ).toEqual(["restored", "checkpoint", "generated", "generated"]);
    expect(database.documents.getRevision(recordingId, 3).markdown).toBe("# Two\n\nUnsaved");
    expect(() => database.documents.restoreRevision(recordingId, 99)).toThrow(
      "Document revision not found",
    );

    database.connection.close();
  });

  it("pages revisions newest first", () => {
    const database = openTestDatabase();
    const recordingId = createTestRecording(database);

    for (let index = 1; index <= 5; index += 1) {
      database.documents.commitRevision(recordingId, "generated", `# Version ${index}`);
    }

    const first = database.documents.listRevisions(recordingId, undefined, 2);

    expect(first.revisions.map((revision) => revision.number)).toEqual([5, 4]);
    expect(first.hasMore).toBe(true);

    const last = database.documents.listRevisions(recordingId, 2, 2);

    expect(last).toEqual({ revisions: [expect.objectContaining({ number: 1 })], hasMore: false });

    database.connection.close();
  });

  it("stores each embedded image once while restoring exact Markdown", () => {
    const database = openTestDatabase();
    const recordingId = createTestRecording(database);
    const markdown = (index: number) =>
      `# Guide ${index}\n\n![Step](${IMAGE})\n\nSmall ![x](data:image/png;base64,AAAA)`;

    for (let index = 1; index <= 20; index += 1) {
      database.documents.save(recordingId, markdown(index), index === 1 ? null : index - 1, 0);
    }

    const { imageCount, bodyBytes } = database.connection.db.get<{
      imageCount: number;
      bodyBytes: number;
    }>(sql`
      SELECT (SELECT count(*) FROM document_images) AS imageCount,
        (SELECT sum(length(body)) FROM document_revisions) AS bodyBytes
    `);

    expect(imageCount).toBe(1);
    expect(bodyBytes).toBeLessThan(IMAGE.length);
    expect(database.documents.getRevision(recordingId, 7).markdown).toBe(markdown(7));
    expect(database.documents.getSnapshot(recordingId).saved?.markdown).toBe(markdown(20));

    // Text that already contains the private delimiters is stored verbatim.
    const delimited = `${"a".repeat(64)} ${IMAGE}`;

    database.documents.commitRevision(recordingId, "generated", delimited);
    expect(database.documents.getRevision(recordingId, 21).markdown).toBe(delimited);

    database.connection.close();
  });

  it("survives a restart and is removed with its recording", () => {
    const database = openTestDatabase();
    const recordingId = createTestRecording(database);

    database.documents.commitRevision(recordingId, "generated", `# Generated\n\n![a](${IMAGE})`);
    database.documents.save(recordingId, "# Saved", null, 0);
    database.documents.saveDraft(recordingId, "# Unsaved recovery", 1);
    database.connection.close();

    const reopened = openTestDatabase(database.databasePath);

    expect(reopened.documents.getSnapshot(recordingId)).toMatchObject({
      saved: { revisionNumber: 2, markdown: "# Saved" },
      draft: { markdown: "# Unsaved recovery" },
      draftVersion: 2,
      latestRevisionNumber: 2,
    });
    expect(reopened.documents.getRevision(recordingId, 1).markdown).toContain(IMAGE);

    reopened.recordings.delete(recordingId);

    const remaining = reopened.connection.db.get<{ rows: number }>(sql`
      SELECT (SELECT count(*) FROM documents) + (SELECT count(*) FROM document_revisions)
        + (SELECT count(*) FROM document_images) + (SELECT count(*) FROM document_drafts) AS rows
    `);

    expect(remaining.rows).toBe(0);
    expect(statSync(reopened.databasePath).size).toBeGreaterThan(0);

    reopened.connection.close();
  });

  it("rejects drafts for a recording that does not exist", () => {
    const database = openTestDatabase();

    expect(() =>
      database.documents.saveDraft("4a4c2a0e-9a55-4a4f-8b53-6d1c1f1f0c01", "# Orphan", 0),
    ).toThrow("Recording not found");
    expect(database.documents.discardDraft("4a4c2a0e-9a55-4a4f-8b53-6d1c1f1f0c01", 0)).toEqual({
      status: "stored",
      draftVersion: 0,
      hasDraft: false,
    });

    database.connection.close();
  });
});
