import { randomUUID } from "node:crypto";
import {
  documentWorkflowPlanSchema,
  generateGuideCollectionInputSchema,
  generatedDocumentCollectionSchema,
  type CommittedGuideCollection,
  type CommittedGuideRevision,
  type DesktopApi,
  type DocumentRevision,
  type DocumentRevisionPage,
  type DocumentWorkflow,
  type GuideDocumentChange,
  type GuideDocumentCollection,
  type GuideDocumentSnapshot,
  type SaveGuideDocumentResult,
  type SaveGuideDraftResult,
} from "@path/shared";
import {
  buildDocumentActivity,
  buildDocumentPrompt,
  buildDocumentUpdatePrompt,
  buildSplitDocumentPrompt,
  buildWorkflowDocumentPrompt,
  MAX_DOCUMENT_IMPORTED_ITEMS,
  normalizeDocumentMarkdown,
} from "../ai/DocumentPrompt";
import type { SelectedAiService } from "../ai/SelectedAiService";
import type { TimelineImportService } from "../recording/TimelineImportService";
import type { RemoteRepositories } from "../storage/DatabaseClient";
import type { Diagnostics } from "../storage/DiagnosticLog";

/** Inputs arrive already validated by the IPC schemas that define the guides bridge. */
type Input<Method extends keyof DesktopApi["guides"]> = Parameters<DesktopApi["guides"][Method]>[0];

/** One generated document awaiting its atomic collection commit. */
interface GeneratedDocumentResult {
  title: string;
  markdown: string;
  documentId?: string;
}

/** Split generation also carries the plan it was generated from, checked at commit time. */
interface GeneratedCollection {
  results: GeneratedDocumentResult[];
  workflowPlan?: { workflows: DocumentWorkflow[]; expectedPlanVersion: number };
}

/** A planned workflow keeps its previous identity when the same title is suggested again. */
function findByTitle<T extends { title: string }>(
  candidates: readonly T[] | null | undefined,
  title: string,
): T | undefined {
  const normalized = title.trim().toLowerCase();

  return candidates?.find((candidate) => candidate.title.trim().toLowerCase() === normalized);
}

/**
 * Owns guide generation and document persistence. Every AI result is committed to durable
 * history before it is returned, drafts and saves are checked against the caller's last-seen
 * version, and each committed change is broadcast so other windows can refresh.
 */
export class GuideDocumentService {
  constructor(
    private readonly repositories: Pick<RemoteRepositories, "recordings" | "documents">,
    private readonly timelineImports: Pick<TimelineImportService, "documentEntries">,
    private readonly ai: Pick<SelectedAiService, "generateText" | "describeContext">,
    private readonly diagnostics: Diagnostics,
    private readonly onChanged: (change: GuideDocumentChange) => void,
  ) {}

  async generate(input: Input<"generate">): Promise<CommittedGuideRevision> {
    const { title, activity } = await this.evidence(input.id);
    const markdown = await this.generateMarkdown(title, activity, input.instructions);

    const committed = await this.repositories.documents.commitRevision(
      input.id,
      "generated",
      markdown,
      input.replacedMarkdown,
      input.documentId,
    );

    this.publish(input.id, input.documentId);

    return committed;
  }

  getCollection(recordingId: string): Promise<GuideDocumentCollection> {
    return this.repositories.documents.getCollection(recordingId);
  }

  async setGenerationMode(input: Input<"setGenerationMode">): Promise<GuideDocumentCollection> {
    const collection = await this.repositories.documents.setGenerationMode(input.id, input.mode);

    this.publishCollection(input.id);

    return collection;
  }

  async generateCollection(input: Input<"generateCollection">): Promise<CommittedGuideCollection> {
    const parsed = generateGuideCollectionInputSchema.parse(input);
    const { title, activity } = await this.evidence(parsed.id);

    const { results, workflowPlan } =
      parsed.mode === "combine"
        ? await this.generateCombinedCollection(title, activity, parsed.instructions)
        : await this.generateSplitCollection(parsed.id, title, activity, parsed.instructions);

    const committed = await this.repositories.documents.commitCollection(
      parsed.id,
      results,
      parsed.replacedMarkdown,
      parsed.documentId,
      parsed.mode,
      workflowPlan,
    );

    this.publishCollection(parsed.id);

    return committed;
  }

  async suggestWorkflows(input: Input<"suggestWorkflows">): Promise<GuideDocumentCollection> {
    const existing = await this.getCollection(input.id);

    if (existing.workflows !== null) return existing;

    const { title, activity } = await this.evidence(input.id);
    const plan = await this.planWorkflows(title, activity, input.instructions);

    return this.saveWorkflowPlan({
      id: input.id,
      expectedPlanVersion: input.expectedPlanVersion,
      workflows: plan.map((workflow) => ({
        ...workflow,
        id: findByTitle(existing.documents, workflow.title)?.id ?? randomUUID(),
      })),
    });
  }

  async saveWorkflowPlan(input: Input<"saveWorkflowPlan">): Promise<GuideDocumentCollection> {
    const collection = await this.repositories.documents.saveWorkflowPlan(
      input.id,
      input.workflows,
      input.expectedPlanVersion,
    );

    this.publishCollection(input.id);

    return collection;
  }

  async update(input: Input<"update">): Promise<CommittedGuideRevision> {
    const { title, activity } = await this.evidence(input.id);
    const prompt = buildDocumentUpdatePrompt(
      title,
      activity,
      input.instructions,
      input.currentMarkdown,
      input.updatePrompt,
      input.context?.length ? await this.ai.describeContext(input.context) : "",
    );

    const markdown = normalizeDocumentMarkdown(
      await this.ai.generateText(prompt, input.contextFolder),
    );

    if (!markdown) throw new Error("The selected AI model returned no guide");

    // The document being updated is checkpointed first when history does not already hold it.
    const committed = await this.repositories.documents.commitRevision(
      input.id,
      "ai-update",
      markdown,
      input.currentMarkdown,
      input.documentId,
    );

    this.publish(input.id, input.documentId);

    return committed;
  }

  getDocument(recordingId: string, documentId?: string): Promise<GuideDocumentSnapshot> {
    return this.repositories.documents.getSnapshot(recordingId, documentId);
  }

  /** Resolves only after the save transaction has committed. */
  async save(input: Input<"saveDocument">): Promise<SaveGuideDocumentResult> {
    const result = await this.repositories.documents.save(
      input.id,
      input.markdown,
      input.expectedSavedRevisionNumber,
      input.draftVersion,
      input.documentId,
    );

    if (result.status === "saved") this.publish(input.id, input.documentId);

    return result;
  }

  async saveDraft(input: Input<"saveDraft">): Promise<SaveGuideDraftResult> {
    const result = await this.repositories.documents.saveDraft(
      input.id,
      input.markdown,
      input.expectedDraftVersion,
      input.documentId,
    );

    if (result.status === "stored") this.publish(input.id, input.documentId);

    return result;
  }

  async discardDraft(input: Input<"discardDraft">): Promise<SaveGuideDraftResult> {
    const result = await this.repositories.documents.discardDraft(
      input.id,
      input.expectedDraftVersion,
      input.documentId,
    );

    if (result.status === "stored") this.publish(input.id, input.documentId);

    return result;
  }

  listRevisions(input: Input<"listRevisions">): Promise<DocumentRevisionPage> {
    return this.repositories.documents.listRevisions(
      input.id,
      input.beforeNumber,
      input.limit,
      input.documentId,
    );
  }

  getRevision(input: Input<"getRevision">): Promise<DocumentRevision> {
    return this.repositories.documents.getRevision(input.id, input.number, input.documentId);
  }

  async restoreRevision(input: Input<"restoreRevision">): Promise<CommittedGuideRevision> {
    const committed = await this.repositories.documents.restoreRevision(
      input.id,
      input.number,
      input.replacedMarkdown,
      input.documentId,
    );

    this.publish(input.id, input.documentId);

    return committed;
  }

  private async generateMarkdown(
    title: string,
    activity: string,
    instructions: string,
  ): Promise<string> {
    const prompt = buildDocumentPrompt(title, activity, instructions);
    const markdown = normalizeDocumentMarkdown(await this.ai.generateText(prompt));

    if (!markdown) throw new Error("The selected AI model returned no guide");

    return markdown;
  }

  private async generateCombinedCollection(
    title: string,
    activity: string,
    instructions: string,
  ): Promise<GeneratedCollection> {
    const markdown = await this.generateMarkdown(title, activity, instructions);

    return { results: [{ title, markdown }] };
  }

  /** The plan version is read before planning so a concurrent tab edit rejects the commit. */
  private async generateSplitCollection(
    recordingId: string,
    title: string,
    activity: string,
    instructions: string,
  ): Promise<GeneratedCollection> {
    const existing = await this.getCollection(recordingId);
    const plan = await this.planWorkflows(title, activity, instructions);
    const workflows = plan.map((workflow) => ({
      ...workflow,
      id: findByTitle(existing.workflows, workflow.title)?.id ?? randomUUID(),
    }));

    const results: GeneratedDocumentResult[] = [];

    for (const workflow of workflows) {
      const markdown = normalizeDocumentMarkdown(
        await this.ai.generateText(
          buildWorkflowDocumentPrompt(title, activity, instructions, workflow),
        ),
      );

      if (!markdown) {
        throw new Error("The model returned an incomplete document set. Retry generation.");
      }

      results.push({ title: workflow.title, markdown, documentId: workflow.id });
    }

    generatedDocumentCollectionSchema.parse({
      documents: results.map(({ title: workflowTitle, markdown }) => ({
        title: workflowTitle,
        markdown,
      })),
    });

    return {
      results,
      workflowPlan: { workflows, expectedPlanVersion: existing.planVersion },
    };
  }

  private async planWorkflows(
    title: string,
    activity: string,
    instructions: string,
  ): Promise<Pick<DocumentWorkflow, "title" | "scope">[]> {
    const response = await this.ai.generateText(
      buildSplitDocumentPrompt(title, activity, instructions),
    );

    try {
      return documentWorkflowPlanSchema.parse(JSON.parse(response)).documents;
    } catch {
      throw new Error("The model returned an invalid or incomplete split plan. Retry.");
    }
  }

  /** Generation reads every stored activity row; imported evidence is sampled across the video. */
  private async evidence(recordingId: string): Promise<{ title: string; activity: string }> {
    const [session, transcript, clicks, importedEntries] = await Promise.all([
      this.repositories.recordings.get(recordingId),
      this.repositories.recordings.listTranscript(recordingId),
      this.repositories.recordings.listClicks(recordingId),
      this.timelineImports.documentEntries(recordingId, MAX_DOCUMENT_IMPORTED_ITEMS),
    ]);

    if (!session) throw new Error(`Recording not found: ${recordingId}`);

    return {
      title: session.title,
      activity: buildDocumentActivity(transcript, clicks, importedEntries),
    };
  }

  /** Collection changes refresh every window's tab structure, not just one editor. */
  private publishCollection(recordingId: string): void {
    this.publish(recordingId, undefined, true);
  }

  /** A committed change is already durable; a failed broadcast must not report it as failed. */
  private publish(recordingId: string, documentId?: string, collectionChanged = false): void {
    this.repositories.documents.getChange(recordingId, documentId).then(
      (change) => {
        this.onChanged(collectionChanged ? { ...change, collectionChanged: true } : change);
      },
      (error: unknown) => {
        this.diagnostics.warn("Unable to broadcast a document change", error);
      },
    );
  }
}
