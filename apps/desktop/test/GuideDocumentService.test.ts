import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_DOCUMENT_IMPORTED_ITEMS } from "../src/ai/DocumentPrompt";
import { GuideDocumentService } from "../src/documents/GuideDocumentService";
import {
  createStoppedRecording,
  openInProcessDatabase,
  type InProcessDatabase,
} from "./InProcessDatabase";

const databases: InProcessDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

async function setup() {
  const database = openInProcessDatabase();

  databases.push(database);

  const recordingId = await createStoppedRecording(database);
  const ai = {
    generateText: vi.fn(async () => "# Generated guide"),
    describeContext: vi.fn(async () => "Screenshot shows Save"),
  };

  const timelineImports = { documentEntries: vi.fn(async () => []) };
  const changes = vi.fn();
  const service = new GuideDocumentService(
    database.repositories,
    timelineImports,
    ai,
    { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    changes,
  );

  return { database, recordingId, ai, timelineImports, changes, service };
}

describe("GuideDocumentService", () => {
  it("commits a generation to history before returning it and checkpoints the text it replaces", async () => {
    const { service, recordingId, changes, timelineImports } = await setup();

    const generated = await service.generate({
      id: recordingId,
      instructions: "Help guide",
      replacedMarkdown: "# Unsaved hand edits",
    });

    expect(generated).toMatchObject({
      markdown: "# Generated guide",
      revision: { number: 2, kind: "generated" },
    });
    expect(timelineImports.documentEntries).toHaveBeenCalledWith(
      recordingId,
      MAX_DOCUMENT_IMPORTED_ITEMS,
    );

    const history = await service.listRevisions({ id: recordingId });

    expect(history.revisions.map((revision) => revision.kind)).toEqual(["generated", "checkpoint"]);
    // Generation neither saves the document nor touches the recovery draft.
    await expect(service.getDocument(recordingId)).resolves.toMatchObject({
      saved: null,
      draft: null,
      latestRevisionNumber: 2,
    });
    await vi.waitFor(() =>
      expect(changes).toHaveBeenCalledWith({
        recordingId,
        draftVersion: 0,
        savedRevisionNumber: null,
        latestRevisionNumber: 2,
      }),
    );
  });

  it("commits nothing when the model fails or returns an empty document", async () => {
    const { service, recordingId, ai } = await setup();

    ai.generateText.mockRejectedValueOnce(new Error("Model offline"));
    await expect(service.generate({ id: recordingId, instructions: "" })).rejects.toThrow(
      "Model offline",
    );

    ai.generateText.mockResolvedValueOnce("   ");
    await expect(service.generate({ id: recordingId, instructions: "" })).rejects.toThrow(
      "returned no guide",
    );
    await expect(service.listRevisions({ id: recordingId })).resolves.toEqual({
      revisions: [],
      hasMore: false,
    });
  });

  it("checkpoints the updated document and records the AI update", async () => {
    const { service, recordingId, ai } = await setup();

    ai.generateText.mockResolvedValueOnce("# Updated guide");

    const updated = await service.update({
      id: recordingId,
      instructions: "Help guide",
      currentMarkdown: "# Current",
      updatePrompt: "Add a step",
      context: [{ kind: "image", name: "a.png", dataUrl: "data:image/png;base64,YQ==" }],
    });

    expect(updated.revision).toMatchObject({ number: 2, kind: "ai-update" });
    expect(ai.generateText).toHaveBeenCalledWith(
      expect.stringContaining("Screenshot shows Save"),
      undefined,
    );
    await expect(service.getRevision({ id: recordingId, number: 1 })).resolves.toMatchObject({
      kind: "checkpoint",
      markdown: "# Current",
    });
  });

  it("acknowledges an explicit save only after it commits and rejects a stale one", async () => {
    const { service, recordingId, changes } = await setup();

    await expect(
      service.saveDraft({ id: recordingId, markdown: "# Draft", expectedDraftVersion: 0 }),
    ).resolves.toEqual({ status: "stored", draftVersion: 1, hasDraft: true });

    const saved = await service.save({
      id: recordingId,
      markdown: "# Draft",
      expectedSavedRevisionNumber: null,
      draftVersion: 1,
    });

    expect(saved).toMatchObject({ status: "saved", revision: { number: 1 }, draftVersion: 2 });
    await expect(service.getDocument(recordingId)).resolves.toMatchObject({
      saved: { revisionNumber: 1, markdown: "# Draft" },
      draft: null,
    });

    changes.mockClear();

    await expect(
      service.save({
        id: recordingId,
        markdown: "# Stale",
        expectedSavedRevisionNumber: null,
        draftVersion: 2,
      }),
    ).resolves.toEqual({ status: "conflict", savedRevisionNumber: 1 });
    expect(changes).not.toHaveBeenCalled();
  });

  it("restores an earlier revision as a new one and discards drafts on request", async () => {
    const { service, recordingId, ai } = await setup();

    await service.generate({ id: recordingId, instructions: "" });
    ai.generateText.mockResolvedValueOnce("# Second");
    await service.generate({ id: recordingId, instructions: "" });

    await expect(
      service.restoreRevision({ id: recordingId, number: 1, replacedMarkdown: "# Second" }),
    ).resolves.toMatchObject({
      markdown: "# Generated guide",
      revision: { number: 3, kind: "restored", restoredFromNumber: 1 },
    });

    await service.saveDraft({ id: recordingId, markdown: "# Scratch", expectedDraftVersion: 0 });
    await expect(
      service.discardDraft({ id: recordingId, expectedDraftVersion: 1 }),
    ).resolves.toEqual({ status: "stored", draftVersion: 2, hasDraft: false });
    await expect(service.getDocument(recordingId)).resolves.toMatchObject({ draft: null });
  });
});
