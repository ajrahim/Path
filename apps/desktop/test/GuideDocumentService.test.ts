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

const SECTION = "Acceptance Criteria";

interface PlannedFixture {
  title: string;
  scope?: string;
  evidence?: { startSeconds: number; endSeconds: number }[];
  sections?: { heading: string; coverage: string }[];
}

/** The first-pass response: one planned document per title unless a fixture says otherwise. */
function structurePlan(documents: (string | PlannedFixture)[], sharedContext = ""): string {
  return JSON.stringify({
    sharedContext,
    documents: documents.map((document) => {
      const fixture = typeof document === "string" ? { title: document } : document;

      return {
        title: fixture.title,
        scope: fixture.scope ?? `Recorded ${fixture.title} workflow`,
        evidence: fixture.evidence ?? [],
        sections: fixture.sections ?? [
          { heading: SECTION, coverage: `What ${fixture.title} must satisfy` },
        ],
      };
    }),
  });
}

/** A second-pass response containing the planned section. */
function documentBody(title: string): string {
  return `# ${title}\n\n## ${SECTION}\nComplete content for ${title}.`;
}

const GENERATED_GUIDE = documentBody("Generated guide");

function isPlanRequest(prompt: string): boolean {
  return prompt.startsWith("Plan the structure");
}

async function setup() {
  const database = openInProcessDatabase();

  databases.push(database);

  const recordingId = await createStoppedRecording(database);
  const ai = {
    generateText: vi.fn(async (prompt: string) =>
      isPlanRequest(prompt) ? structurePlan(["Generated guide"]) : GENERATED_GUIDE,
    ),
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
        structurePlan(
          [
            {
              title: "Login",
              scope: "Email/password sign-in at 1s",
              evidence: [{ startSeconds: 0, endSeconds: 2 }],
              sections: [
                { heading: "Current Behavior", coverage: "Sign-in narration at 1.0s" },
                { heading: SECTION, coverage: "Given/When/Then for sign-in" },
              ],
            },
            { title: "Registration", scope: "Account creation and email confirmation at 3s" },
          ],
          "Acme Portal visitors authenticate by email.",
        ),
      )
      .mockResolvedValueOnce(
        `# Login specification\n\n## Current Behavior\nSign in at 1.0s.\n\n## ${SECTION}\nSign in using email and password.`,
      )
      .mockResolvedValueOnce(
        `# Registration specification\n\n## ${SECTION}\nCreate and confirm an account.`,
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
    expect(generated.workflows).toMatchObject([
      { title: "Login", scope: "Email/password sign-in at 1s" },
      { title: "Registration", scope: "Account creation and email confirmation at 3s" },
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

    // One structure request, then one write request per planned document.
    expect(ai.generateText).toHaveBeenCalledTimes(3);
    const [planningPrompt, loginPrompt, registrationPrompt] = ai.generateText.mock.calls.map(
      ([prompt]) => prompt,
    );

    expect(planningPrompt).toContain("Plan separate documents for EVERY distinct workflow");
    expect(planningPrompt).toContain("signs in with email and password");
    expect(planningPrompt).toContain("registers and confirms their email");
    expect(planningPrompt).toContain("Login form > email field");
    expect(planningPrompt).not.toContain("testt");
    expect(loginPrompt).toContain("planned document only: Login");
    expect(loginPrompt).toContain("Document scope: Email/password sign-in at 1s");
    expect(loginPrompt).toContain("Primary evidence time ranges: 0.0s–2.0s");
    expect(loginPrompt).toContain("1. Current Behavior — Sign-in narration at 1.0s");
    expect(loginPrompt).toContain(`2. ${SECTION} — Given/When/Then for sign-in`);
    expect(loginPrompt).toContain("Acme Portal visitors authenticate by email.");
    expect(loginPrompt).toContain("- Registration: Account creation and email confirmation at 3s");
    expect(loginPrompt).toContain("signs in with email and password");
    expect(registrationPrompt).toContain("planned document only: Registration");
    expect(registrationPrompt).toContain("- Login: Email/password sign-in at 1s");
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
      .mockResolvedValueOnce(structurePlan(["Login"]))
      .mockResolvedValueOnce(documentBody("Login"));
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
  )("plans then writes documents for $flow.id in $mode mode", async ({ flow, mode }) => {
    const { service, recordingId, ai } = await setup();
    const titles = mode === "split" ? ["Login", "Registration", "Forgot Password"] : ["Combined"];

    ai.generateText.mockResolvedValueOnce(structurePlan(titles));
    for (const title of titles) ai.generateText.mockResolvedValueOnce(documentBody(title));

    const result = await service.generateCollection({
      id: recordingId,
      instructions: flow.instructions,
      mode,
    });

    expect(result.documents).toHaveLength(titles.length);
    expect(result.generated).toHaveLength(result.documents.length);
    expect(result.mode).toBe(mode);
    expect(ai.generateText).toHaveBeenCalledTimes(titles.length + 1);
    expect(ai.generateText.mock.calls[0]![0]).toContain(
      mode === "split" ? "EVERY distinct workflow" : "Plan exactly one document",
    );
    for (const [prompt] of ai.generateText.mock.calls) expect(prompt).toContain(flow.instructions);
    for (const [index, document] of result.documents.entries()) {
      expect(await service.getDocument(recordingId, document.id)).toMatchObject({
        saved: null,
        draft: { markdown: documentBody(titles[index]!) },
        latestRevisionNumber: 1,
      });
    }
  });

  it("accepts a plan wrapped in a fence and prose", async () => {
    const { service, recordingId, ai } = await setup();

    ai.generateText
      .mockResolvedValueOnce(
        "Here is the plan:\n```json\n" + structurePlan(["Login"]) + "\n```\nDone.",
      )
      .mockResolvedValueOnce(documentBody("Login"));
    const result = await service.generateCollection({
      id: recordingId,
      mode: "split",
      instructions: "Spec",
    });

    expect(result.documents.map((document) => document.title)).toEqual(["Login"]);
    expect(ai.generateText).toHaveBeenCalledTimes(2);
  });

  it("retries an invalid plan once, naming the problem", async () => {
    const { service, recordingId, ai } = await setup();

    ai.generateText
      .mockResolvedValueOnce('{"sharedContext":"","documents":[]}')
      .mockResolvedValueOnce(structurePlan(["Login"]))
      .mockResolvedValueOnce(documentBody("Login"));
    const result = await service.generateCollection({
      id: recordingId,
      mode: "split",
      instructions: "Spec",
    });

    expect(result.documents.map((document) => document.title)).toEqual(["Login"]);
    expect(ai.generateText).toHaveBeenCalledTimes(3);
    const [planningPrompt, repairPrompt] = ai.generateText.mock.calls.map(([prompt]) => prompt);

    expect(repairPrompt).toContain(planningPrompt);
    expect(repairPrompt).toContain("A previous response to this request was rejected: documents");
  });

  it("requires a combine plan to hold exactly one document", async () => {
    const { service, recordingId, ai } = await setup();

    ai.generateText
      .mockResolvedValueOnce(structurePlan(["Login", "Registration"]))
      .mockResolvedValueOnce(structurePlan(["Whole recording"]))
      .mockResolvedValueOnce(documentBody("Whole recording"));
    const result = await service.generateCollection({
      id: recordingId,
      mode: "combine",
      instructions: "Spec",
    });

    expect(result.documents).toHaveLength(1);
    expect(ai.generateText.mock.calls[1]![0]).toContain("exactly one document");
    expect((await service.getDocument(recordingId, result.documents[0]!.id)).draft?.markdown).toBe(
      documentBody("Whole recording"),
    );
  });

  it("rewrites a document that omits a planned section once, then fails without committing", async () => {
    const { service, recordingId, ai } = await setup();
    const incomplete = "# Login\n\nThe criteria are not written yet.";

    ai.generateText
      .mockResolvedValueOnce(structurePlan(["Login"]))
      .mockResolvedValueOnce(incomplete)
      .mockResolvedValueOnce(documentBody("Login"));
    const result = await service.generateCollection({
      id: recordingId,
      mode: "split",
      instructions: "Spec",
    });

    expect(ai.generateText).toHaveBeenCalledTimes(3);
    expect(ai.generateText.mock.calls[2]![0]).toContain(
      `omitted these required sections: ${SECTION}`,
    );
    expect((await service.getDocument(recordingId, result.documents[0]!.id)).draft?.markdown).toBe(
      documentBody("Login"),
    );

    const committed = await service.getCollection(recordingId);

    ai.generateText
      .mockResolvedValueOnce(structurePlan(["Registration"]))
      .mockResolvedValueOnce(incomplete)
      .mockResolvedValueOnce(incomplete);
    await expect(
      service.generateCollection({ id: recordingId, mode: "split", instructions: "Spec" }),
    ).rejects.toThrow("incomplete document");
    expect(ai.generateText).toHaveBeenCalledTimes(6);
    expect(await service.getCollection(recordingId)).toEqual(committed);
  });

  it("plans from the whole recording and writes each document from its own time range", async () => {
    const { service, recordingId, ai, database } = await setup();

    await database.repositories.recordings.replaceTranscript(
      recordingId,
      Array.from({ length: 600 }, (_, index) => ({
        id: randomUUID(),
        recordingId,
        startMs: index * 1_000,
        endMs: index * 1_000 + 500,
        text: `Narration ${index}`,
      })),
    );
    ai.generateText
      .mockResolvedValueOnce(
        structurePlan([{ title: "Checkout", evidence: [{ startSeconds: 450, endSeconds: 549 }] }]),
      )
      .mockResolvedValueOnce(documentBody("Checkout"));
    await service.generateCollection({ id: recordingId, mode: "split", instructions: "Spec" });

    const [planningPrompt, writePrompt] = ai.generateText.mock.calls.map(([prompt]) => prompt);
    const narrationLines = (prompt: string) =>
      prompt.split("\n").filter((line) => line.includes("] Speech: Narration "));

    // 600 entries exceed the 300-entry budget: planning samples the whole recording.
    expect(narrationLines(planningPrompt)).toHaveLength(300);
    expect(planningPrompt).toContain("[0.0s] Speech: Narration 0");
    expect(planningPrompt).toContain("[598.0s] Speech: Narration 598");

    // The document's own range arrives complete; the rest stays sampled for context.
    expect(narrationLines(writePrompt)).toHaveLength(300);
    for (let second = 450; second <= 549; second += 1) {
      expect(writePrompt).toContain(`[${second}.0s] Speech: Narration ${second}\n`);
    }
  });

  it("accepts one coherent workflow and retains its identity and history when regenerating", async () => {
    const { service, recordingId, ai } = await setup();
    const plan = structurePlan(["Login"]);

    ai.generateText.mockResolvedValueOnce(plan).mockResolvedValueOnce(documentBody("Login"));
    const original = await service.generateCollection({
      id: recordingId,
      instructions: "Spec",
      mode: "split",
    });

    ai.generateText
      .mockResolvedValueOnce(plan)
      .mockResolvedValueOnce(documentBody("Revised Login"));
    const regenerated = await service.generateCollection({
      id: recordingId,
      instructions: "Spec",
      mode: "split",
    });

    expect(regenerated.documents).toEqual(original.documents);
    expect(regenerated.planVersion).toBe(original.planVersion + 1);
    expect(
      (await service.getDocument(recordingId, original.documents[0]!.id)).draft?.markdown,
    ).toBe(documentBody("Revised Login"));
    expect(
      (
        await service.getRevision({
          id: recordingId,
          documentId: original.documents[0]!.id,
          number: 1,
        })
      ).markdown,
    ).toBe(documentBody("Login"));
  });

  it("preserves current tabs and documents when automatic planning is invalid or unavailable", async () => {
    const { service, recordingId, ai } = await setup();

    ai.generateText
      .mockResolvedValueOnce(structurePlan(["Login"]))
      .mockResolvedValueOnce(documentBody("Login"));
    const original = await service.generateCollection({
      id: recordingId,
      instructions: "Spec",
      mode: "split",
    });

    const snapshot = await service.getDocument(recordingId, original.documents[0]!.id);

    for (const response of [
      "not JSON",
      '{"sharedContext":"","documents":[]}',
      // The earlier title-and-scope plan shape no longer carries enough structure.
      '{"documents":[{"title":"Login","scope":"Recorded login"}]}',
      structurePlan([{ title: "Login", scope: " " }]),
      structurePlan(["Login", "login"]),
      structurePlan([{ title: "Login", sections: [] }]),
      structurePlan(Array.from({ length: 25 }, (_, index) => "Workflow " + index)),
    ]) {
      const requestsBefore = ai.generateText.mock.calls.length;

      // The same invalid answer to the plan request and to its one correction request.
      ai.generateText.mockResolvedValueOnce(response).mockResolvedValueOnce(response);
      await expect(
        service.generateCollection({ id: recordingId, instructions: "Spec", mode: "split" }),
      ).rejects.toThrow("invalid or incomplete document plan");
      expect(ai.generateText).toHaveBeenCalledTimes(requestsBefore + 2);
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

    const plan = structurePlan(["Login", "Registration"]);

    ai.generateText
      .mockResolvedValueOnce(plan)
      .mockResolvedValueOnce(documentBody("Login"))
      .mockRejectedValueOnce(new Error("Model offline"));
    await expect(
      service.generateCollection({ id: recordingId, instructions: "Spec", mode: "split" }),
    ).rejects.toThrow("Model offline");
    expect(await service.getCollection(recordingId)).toEqual(previous);
    ai.generateText
      .mockResolvedValueOnce(plan)
      .mockResolvedValueOnce(documentBody("Login"))
      .mockResolvedValueOnce(" ");
    await expect(
      service.generateCollection({ id: recordingId, instructions: "Spec", mode: "split" }),
    ).rejects.toThrow("incomplete document");
    expect(await service.getCollection(recordingId)).toEqual(previous);
    expect(
      (await service.getDocument(recordingId, original.documents[0]!.id)).draft?.markdown,
    ).toBe(GENERATED_GUIDE);
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

        return structurePlan(["Login"]);
      })
      .mockResolvedValueOnce(documentBody("Login"));
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
    ).toBe(GENERATED_GUIDE);
  });

  it("suggests workflow tabs from the structure plan without writing documents", async () => {
    const { service, recordingId, ai } = await setup();

    ai.generateText.mockResolvedValueOnce(
      structurePlan([{ title: "Login", scope: "Sign-in at 1s" }, "Registration"]),
    );
    const suggested = await service.suggestWorkflows({
      id: recordingId,
      instructions: "Spec",
      expectedPlanVersion: 0,
    });

    expect(ai.generateText).toHaveBeenCalledTimes(1);
    expect(suggested.documents).toEqual([]);
    expect(suggested.workflows).toMatchObject([
      { title: "Login", scope: "Sign-in at 1s" },
      { title: "Registration", scope: "Recorded Registration workflow" },
    ]);
    // The outline guides one generation; the stored tab plan keeps only title and scope.
    expect(suggested.workflows![0]).not.toHaveProperty("sections");
    expect(suggested.workflows![0]).not.toHaveProperty("evidence");
  });

  it("plans one document, commits it to history before returning, and checkpoints replaced text", async () => {
    const { service, recordingId, ai, changes, timelineImports } = await setup();

    const generated = await service.generate({
      id: recordingId,
      instructions: "Help guide",
      replacedMarkdown: "# Unsaved hand edits",
    });

    expect(generated).toMatchObject({
      markdown: GENERATED_GUIDE,
      revision: { number: 2, kind: "generated" },
    });
    expect(ai.generateText).toHaveBeenCalledTimes(2);
    expect(ai.generateText.mock.calls[0]![0]).toContain("Plan exactly one document");
    expect(ai.generateText.mock.calls[1]![0]).toContain(`1. ${SECTION} — `);
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

    ai.generateText.mockResolvedValueOnce(structurePlan(["Guide"])).mockResolvedValueOnce("   ");
    await expect(service.generate({ id: recordingId, instructions: "" })).rejects.toThrow(
      "incomplete document",
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
    expect(ai.generateText).toHaveBeenCalledTimes(1);
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
    ai.generateText
      .mockResolvedValueOnce(structurePlan(["Second"]))
      .mockResolvedValueOnce(documentBody("Second"));
    await service.generate({ id: recordingId, instructions: "" });

    await expect(
      service.restoreRevision({
        id: recordingId,
        number: 1,
        replacedMarkdown: documentBody("Second"),
      }),
    ).resolves.toMatchObject({
      markdown: GENERATED_GUIDE,
      revision: { number: 3, kind: "restored", restoredFromNumber: 1 },
    });

    await service.saveDraft({ id: recordingId, markdown: "# Scratch", expectedDraftVersion: 0 });
    await expect(
      service.discardDraft({ id: recordingId, expectedDraftVersion: 1 }),
    ).resolves.toEqual({ status: "stored", draftVersion: 2, hasDraft: false });
    await expect(service.getDocument(recordingId)).resolves.toMatchObject({ draft: null });
  });
});
