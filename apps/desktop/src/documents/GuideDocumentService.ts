import { randomUUID } from "node:crypto";
import {
  generateGuideCollectionInputSchema,
  generatedDocumentCollectionSchema,
  type ClickEvent,
  type CommittedGuideCollection,
  type CommittedGuideRevision,
  type DesktopApi,
  type DocumentEvidenceRange,
  type DocumentGenerationMode,
  type DocumentRevision,
  type DocumentRevisionPage,
  type DocumentStructurePlan,
  type DocumentWorkflow,
  type GuideDocumentChange,
  type GuideDocumentCollection,
  type GuideDocumentSnapshot,
  type PlannedDocument,
  type SaveGuideDocumentResult,
  type SaveGuideDraftResult,
  type TranscriptSegment,
} from "@path/shared";
import {
  buildDocumentActivity,
  buildDocumentUpdatePrompt,
  MAX_DOCUMENT_IMPORTED_ITEMS,
  normalizeDocumentMarkdown,
} from "../ai/DocumentPrompt";
import {
  buildPlannedDocumentPrompt,
  buildSectionRepairPrompt,
  buildStructurePlanPrompt,
  buildStructurePlanRepairPrompt,
  findMissingSections,
  parseStructurePlan,
} from "../ai/DocumentStructurePlan";
import type { SelectedAiService } from "../ai/SelectedAiService";
import type {
  DocumentTimelineEntry,
  TimelineImportService,
} from "../recording/TimelineImportService";
import type { RemoteRepositories } from "../storage/DatabaseClient";
import type { Diagnostics } from "../storage/DiagnosticLog";

/** Inputs arrive already validated by the IPC schemas that define the guides bridge. */
type Input<Method extends keyof DesktopApi["guides"]> = Parameters<DesktopApi["guides"][Method]>[0];

/** Everything recorded for one session; each prompt selects the activity it needs from it. */
interface RecordingEvidence {
  title: string;
  transcript: TranscriptSegment[];
  clicks: ClickEvent[];
  importedEntries: DocumentTimelineEntry[];
}

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

const INCOMPLETE_DOCUMENT_MESSAGE = "The model returned an incomplete document. Retry generation.";

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
    const evidence = await this.evidence(input.id);
    const markdown = await this.writeCombinedDocument(evidence, input.instructions);

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
    const evidence = await this.evidence(parsed.id);

    const { results, workflowPlan } =
      parsed.mode === "combine"
        ? await this.generateCombinedCollection(evidence, parsed.instructions)
        : await this.generateSplitCollection(parsed.id, evidence, parsed.instructions);

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

    const evidence = await this.evidence(input.id);
    const plan = await this.planStructure(evidence, input.instructions, "split");

    return this.saveWorkflowPlan({
      id: input.id,
      expectedPlanVersion: input.expectedPlanVersion,
      workflows: plan.documents.map((document) => ({
        id: findByTitle(existing.documents, document.title)?.id ?? randomUUID(),
        title: document.title,
        scope: document.scope,
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
    const evidence = await this.evidence(input.id);
    const prompt = buildDocumentUpdatePrompt(
      evidence.title,
      this.activity(evidence),
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

  /** Combine plans one document for the whole recording, then writes it from that outline. */
  private async writeCombinedDocument(
    evidence: RecordingEvidence,
    instructions: string,
  ): Promise<string> {
    const plan = await this.planStructure(evidence, instructions, "combine");

    // The plan parser guarantees exactly one document in combine mode.
    return this.writePlannedDocument(evidence, instructions, plan, plan.documents[0]!);
  }

  private async generateCombinedCollection(
    evidence: RecordingEvidence,
    instructions: string,
  ): Promise<GeneratedCollection> {
    const markdown = await this.writeCombinedDocument(evidence, instructions);

    return { results: [{ title: evidence.title, markdown }] };
  }

  /** The plan version is read before planning so a concurrent tab edit rejects the commit. */
  private async generateSplitCollection(
    recordingId: string,
    evidence: RecordingEvidence,
    instructions: string,
  ): Promise<GeneratedCollection> {
    const existing = await this.getCollection(recordingId);
    const plan = await this.planStructure(evidence, instructions, "split");

    const workflows: DocumentWorkflow[] = [];
    const results: GeneratedDocumentResult[] = [];

    for (const document of plan.documents) {
      const id = findByTitle(existing.workflows, document.title)?.id ?? randomUUID();
      const markdown = await this.writePlannedDocument(evidence, instructions, plan, document);

      workflows.push({ id, title: document.title, scope: document.scope });
      results.push({ title: document.title, markdown, documentId: id });
    }

    generatedDocumentCollectionSchema.parse({
      documents: results.map(({ title, markdown }) => ({ title, markdown })),
    });

    return {
      results,
      workflowPlan: { workflows, expectedPlanVersion: existing.planVersion },
    };
  }

  /**
   * First pass. An invalid plan is retried once with the validation problem, because repeating
   * the identical request would repeat the identical answer.
   */
  private async planStructure(
    evidence: RecordingEvidence,
    instructions: string,
    mode: DocumentGenerationMode,
  ): Promise<DocumentStructurePlan> {
    const prompt = buildStructurePlanPrompt(
      evidence.title,
      this.activity(evidence),
      instructions,
      mode,
    );

    const planned = parseStructurePlan(await this.ai.generateText(prompt), mode);

    if (planned.isValid) return planned.plan;

    const repaired = parseStructurePlan(
      await this.ai.generateText(buildStructurePlanRepairPrompt(prompt, planned.problem)),
      mode,
    );

    if (repaired.isValid) return repaired.plan;

    throw new Error("The model returned an invalid or incomplete document plan. Retry generation.");
  }

  /**
   * Second pass. A document must contain every planned section; one rewrite is allowed before
   * the whole generation fails without committing anything.
   */
  private async writePlannedDocument(
    evidence: RecordingEvidence,
    instructions: string,
    plan: DocumentStructurePlan,
    document: PlannedDocument,
  ): Promise<string> {
    const prompt = buildPlannedDocumentPrompt(
      evidence.title,
      this.activity(evidence, document.evidence),
      instructions,
      plan,
      document,
    );

    const markdown = normalizeDocumentMarkdown(await this.ai.generateText(prompt));

    if (!markdown) throw new Error(INCOMPLETE_DOCUMENT_MESSAGE);

    const missingSections = findMissingSections(markdown, document);

    if (missingSections.length === 0) return markdown;

    const rewritten = normalizeDocumentMarkdown(
      await this.ai.generateText(buildSectionRepairPrompt(prompt, missingSections)),
    );

    if (!rewritten || findMissingSections(rewritten, document).length > 0) {
      throw new Error(INCOMPLETE_DOCUMENT_MESSAGE);
    }

    return rewritten;
  }

  /** Activity for one prompt; a document's own time ranges are kept at full density. */
  private activity(
    evidence: RecordingEvidence,
    focusRanges: readonly DocumentEvidenceRange[] = [],
  ): string {
    return buildDocumentActivity(
      evidence.transcript,
      evidence.clicks,
      evidence.importedEntries,
      focusRanges,
    );
  }

  /** Generation reads every stored activity row; imported evidence is sampled across the video. */
  private async evidence(recordingId: string): Promise<RecordingEvidence> {
    const [session, transcript, clicks, importedEntries] = await Promise.all([
      this.repositories.recordings.get(recordingId),
      this.repositories.recordings.listTranscript(recordingId),
      this.repositories.recordings.listClicks(recordingId),
      this.timelineImports.documentEntries(recordingId, MAX_DOCUMENT_IMPORTED_ITEMS),
    ]);

    if (!session) throw new Error(`Recording not found: ${recordingId}`);

    return { title: session.title, transcript, clicks, importedEntries };
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
