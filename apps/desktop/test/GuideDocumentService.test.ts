import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILT_IN_FLOWS } from "@path/shared";
import { MAX_DOCUMENT_IMPORTED_ITEMS } from "../src/ai/DocumentPrompt";
import { GuideDocumentService } from "../src/documents/GuideDocumentService";
import type { DocumentTimelineEntry } from "../src/recording/TimelineImportService";
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
    generateText: vi.fn(async (_prompt: string) => "# Generated guide"),
    describeContext: vi.fn(async () => "Screenshot shows Save"),
  };

  const timelineImports = {
    documentEntries: vi.fn(async (): Promise<DocumentTimelineEntry[]> => []),
  };

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
  it("discovers workflows from content instead of fitting existing placeholder tabs", async () => {
    const { service, recordingId, ai, database, timelineImports } = await setup();
    const placeholderPlan = await service.saveWorkflowPlan({
      id: recordingId,
      expectedPlanVersion: 0,
      workflows: ["test", "new", "testt"].map((title) => ({
        id: randomUUID(),
        title,
        scope: title,
      })),
    });

    await database.repositories.recordings.replaceTranscript(recordingId, [
      {
        id: randomUUID(),
        recordingId,
        startMs: 1000,
        endMs: 2000,
        text: "The user signs in with email and password.",
      },
      {
        id: randomUUID(),
        recordingId,
        startMs: 3000,
        endMs: 4000,
        text: "A new user registers and confirms their email.",
      },
    ]);
    timelineImports.documentEntries.mockResolvedValueOnce([
      { kind: "element", timestampMs: 1100, text: "Login form > email field" },
    ]);
    ai.generateText
      .mockResolvedValueOnce(
        JSON.stringify({
          documents: [
            { title: "Login", scope: "Email/password sign-in at 1s" },
            { title: "Registration", scope: "Account creation and email confirmation at 3s" },
          ],
        }),
      )
      .mockResolvedValueOnce(
        "# Login specification\n\n## Acceptance criteria\nSign in using email and password.",
      )
      .mockResolvedValueOnce(
        "# Registration specification\n\n## Acceptance criteria\nCreate and confirm an account.",
      );
    const generated = await service.generateCollection({
      id: recordingId,
      mode: "split",
      instructions: "Create a spec with acceptance criteria.",
    });

    expect(generated.documents.map((document) => document.title)).toEqual([
      "Login",
      "Registration",
    ]);
    expect(generated.workflows?.map((workflow) => workflow.title)).toEqual([
      "Login",
      "Registration",
    ]);
    expect(generated.mode).toBe("split");
    expect(generated.planVersion).toBe(placeholderPlan.planVersion + 1);
    expect(generated.workflows?.map((workflow) => workflow.documentId)).toEqual(
      generated.documents.map((document) => document.id),
    );
    expect(
      generated.documents.every(
        (document) => !placeholderPlan.workflows!.some((workflow) => workflow.id === document.id),
      ),
    ).toBe(true);
    expect(ai.generateText).toHaveBeenCalledTimes(3);
    const planningPrompt = ai.generateText.mock.calls[0]![0];

    expect(planningPrompt).toContain("Plan separate documents for EVERY distinct workflow");
    expect(planningPrompt).toContain("signs in with email and password");
    expect(planningPrompt).toContain("registers and confirms their email");
    expect(planningPrompt).toContain("Login form > email field");
    expect(planningPrompt).not.toContain("testt");
    expect(planningPrompt).not.toContain("Workflow scope: test");
    expect(ai.generateText.mock.calls[1]![0]).toContain("workflow only: Login");
    expect(ai.generateText.mock.calls[2]![0]).toContain("workflow only: Registration");
    for (const [prompt] of ai.generateText.mock.calls) {
      expect(prompt).toContain("Create a spec with acceptance criteria.");
    }

    expect(
      (await service.getDocument(recordingId, generated.documents[1]!.id)).draft?.markdown,
    ).toContain("Registration specification");
  });

  it("discovers fresh workflows when the stored tab list is intentionally empty", async () => {
    const { service, recordingId, ai } = await setup();

    await service.saveWorkflowPlan({ id: recordingId, expectedPlanVersion: 0, workflows: [] });
    ai.generateText
      .mockResolvedValueOnce(
        JSON.stringify({ documents: [{ title: "Login", scope: "Recorded login" }] }),
      )
      .mockResolvedValueOnce("# Login");
    const result = await service.generateCollection({
      id: recordingId,
      mode: "split",
      instructions: "Spec",
    });

    expect(result.documents.map((document) => document.title)).toEqual(["Login"]);
    expect(result.workflows).toHaveLength(1);
    expect(result.planVersion).toBe(2);
  });

  it.each(
    [...BUILT_IN_FLOWS, { id: "custom", instructions: "Custom review" }].flatMap((flow) =>
      (["combine", "split"] as const).map((mode) => ({ flow, mode })),
    ),
  )("generates content-selected documents for $flow.id in $mode mode", async ({ flow, mode }) => {
    const { service, recordingId, ai } = await setup();
    const documents = ["Login", "Registration", "Forgot Password"].map((title) => ({
      title,
      markdown: "# " + title + "\n\nComplete content",
    }));

    if (mode === "split") {
      ai.generateText.mockResolvedValueOnce(
        JSON.stringify({
          documents: documents.map((document) => ({
            title: document.title,
            scope: "Recorded " + document.title + " workflow",
          })),
        }),
      );
      for (const document of documents) ai.generateText.mockResolvedValueOnce(document.markdown);
    } else {
      ai.generateText.mockResolvedValueOnce("# Combined");
    }

    const result = await service.generateCollection({
      id: recordingId,
      instructions: flow.instructions,
      mode,
    });

    expect(result.documents).toHaveLength(mode === "split" ? 3 : 1);
    expect(result.generated).toHaveLength(result.documents.length);
    expect(result.mode).toBe(mode);
    expect(ai.generateText).toHaveBeenCalledTimes(mode === "split" ? 4 : 1);
    for (const [prompt] of ai.generateText.mock.calls) expect(prompt).toContain(flow.instructions);
    for (const document of result.documents) {
      expect(await service.getDocument(recordingId, document.id)).toMatchObject({
        saved: null,
        draft: { markdown: expect.any(String) },
        latestRevisionNumber: 1,
      });
    }
  });

  it("accepts one coherent workflow and retains its identity and history when regenerating", async () => {
    const { service, recordingId, ai } = await setup();
    const plan = JSON.stringify({
      documents: [{ title: "Login", scope: "Recorded login workflow" }],
    });

    ai.generateText.mockResolvedValueOnce(plan).mockResolvedValueOnce("# Login");
    const original = await service.generateCollection({
      id: recordingId,
      instructions: "Spec",
      mode: "split",
    });

    ai.generateText.mockResolvedValueOnce(plan).mockResolvedValueOnce("# Revised Login");
    const regenerated = await service.generateCollection({
      id: recordingId,
      instructions: "Spec",
      mode: "split",
    });

    expect(regenerated.documents).toEqual(original.documents);
    expect(regenerated.planVersion).toBe(original.planVersion + 1);
    expect(
      (await service.getDocument(recordingId, original.documents[0]!.id)).draft?.markdown,
    ).toBe("# Revised Login");
    expect(
      (
        await service.getRevision({
          id: recordingId,
          documentId: original.documents[0]!.id,
          number: 1,
        })
      ).markdown,
    ).toBe("# Login");
  });

  it("preserves current tabs and documents when automatic planning is invalid or unavailable", async () => {
    const { service, recordingId, ai } = await setup();

    ai.generateText
      .mockResolvedValueOnce(
        JSON.stringify({ documents: [{ title: "Login", scope: "Recorded login" }] }),
      )
      .mockResolvedValueOnce("# Login");
    const original = await service.generateCollection({
      id: recordingId,
      instructions: "Spec",
      mode: "split",
    });

    const snapshot = await service.getDocument(recordingId, original.documents[0]!.id);

    for (const response of [
      "not JSON",
      '{"documents":[]}',
      '{"documents":[{"title":"Login","scope":" "}]}',
      JSON.stringify({
        documents: [
          { title: "Login", scope: "One" },
          { title: "login", scope: "Two" },
        ],
      }),
      JSON.stringify({
        documents: Array.from({ length: 25 }, (_, index) => ({
          title: "Workflow " + index,
          scope: "Recorded workflow",
        })),
      }),
    ]) {
      ai.generateText.mockResolvedValueOnce(response);
      await expect(
        service.generateCollection({ id: recordingId, instructions: "Spec", mode: "split" }),
      ).rejects.toThrow("invalid or incomplete split plan");
      expect(await service.getCollection(recordingId)).toMatchObject({
        documents: original.documents,
        workflows: original.workflows,
        planVersion: original.planVersion,
        mode: "split",
      });
      expect(await service.getDocument(recordingId, original.documents[0]!.id)).toEqual(snapshot);
    }

    ai.generateText.mockRejectedValueOnce(new Error("Offline"));
    await expect(
      service.generateCollection({ id: recordingId, instructions: "Spec", mode: "split" }),
    ).rejects.toThrow("Offline");
    expect(await service.getDocument(recordingId, original.documents[0]!.id)).toEqual(snapshot);
  });

  it("commits neither the new plan nor partial documents when a later workflow fails", async () => {
    const { service, recordingId, ai } = await setup();
    const original = await service.generateCollection({
      id: recordingId,
      instructions: "Spec",
      mode: "combine",
    });

    const previous = await service.saveWorkflowPlan({
      id: recordingId,
      expectedPlanVersion: 0,
      workflows: ["test", "new", "testt"].map((title) => ({
        id: randomUUID(),
        title,
        scope: title,
      })),
    });

    const plan = JSON.stringify({
      documents: [
        { title: "Login", scope: "Login screen" },
        { title: "Registration", scope: "Registration screen" },
      ],
    });

    ai.generateText
      .mockResolvedValueOnce(plan)
      .mockResolvedValueOnce("# Login")
      .mockRejectedValueOnce(new Error("Model offline"));
    await expect(
      service.generateCollection({ id: recordingId, instructions: "Spec", mode: "split" }),
    ).rejects.toThrow("Model offline");
    expect(await service.getCollection(recordingId)).toEqual(previous);
    ai.generateText
      .mockResolvedValueOnce(plan)
      .mockResolvedValueOnce("# Login")
      .mockResolvedValueOnce(" ");
    await expect(
      service.generateCollection({ id: recordingId, instructions: "Spec", mode: "split" }),
    ).rejects.toThrow("incomplete document set");
    expect(await service.getCollection(recordingId)).toEqual(previous);
    expect(
      (await service.getDocument(recordingId, original.documents[0]!.id)).draft?.markdown,
    ).toBe("# Generated guide");
  });

  it("rejects a completed automatic generation if another window edited the plan meanwhile", async () => {
    const { service, recordingId, ai } = await setup();
    const original = await service.generateCollection({
      id: recordingId,
      instructions: "Spec",
      mode: "combine",
    });

    const concurrent = [{ id: randomUUID(), title: "Manual tab", scope: "Manual scope" }];

    ai.generateText
      .mockImplementationOnce(async () => {
        await service.saveWorkflowPlan({
          id: recordingId,
          expectedPlanVersion: 0,
          workflows: concurrent,
        });

        return JSON.stringify({ documents: [{ title: "Login", scope: "Recorded login" }] });
      })
      .mockResolvedValueOnce("# Login");
    await expect(
      service.generateCollection({ id: recordingId, instructions: "Spec", mode: "split" }),
    ).rejects.toThrow("changed in another window");
    expect(await service.getCollection(recordingId)).toMatchObject({
      documents: original.documents,
      workflows: concurrent,
      planVersion: 1,
    });
    expect(
      (await service.getDocument(recordingId, original.documents[0]!.id)).draft?.markdown,
    ).toBe("# Generated guide");
  });

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
