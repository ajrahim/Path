import type {
  CommittedGuideRevision,
  DesktopApi,
  DocumentRevision,
  DocumentRevisionPage,
  GuideDocumentChange,
  GuideDocumentSnapshot,
  SaveGuideDocumentResult,
  SaveGuideDraftResult,
} from "@path/shared";
import {
  buildDocumentActivity,
  buildDocumentPrompt,
  buildDocumentUpdatePrompt,
  MAX_DOCUMENT_IMPORTED_ITEMS,
  normalizeDocumentMarkdown,
} from "../ai/DocumentPrompt";
import type { SelectedAiService } from "../ai/SelectedAiService";
import type { TimelineImportService } from "../recording/TimelineImportService";
import type { RemoteRepositories } from "../storage/DatabaseClient";
import type { Diagnostics } from "../storage/DiagnosticLog";

/** Inputs arrive already validated by the IPC schemas that define the guides bridge. */
type Input<Method extends keyof DesktopApi["guides"]> = Parameters<DesktopApi["guides"][Method]>[0];

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
    const prompt = buildDocumentPrompt(title, activity, input.instructions);
    const markdown = normalizeDocumentMarkdown(await this.ai.generateText(prompt));

    if (!markdown) throw new Error("The selected AI model returned no guide");

    const committed = await this.repositories.documents.commitRevision(
      input.id,
      "generated",
      markdown,
      input.replacedMarkdown,
    );

    this.publish(input.id);

    return committed;
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
    );

    this.publish(input.id);

    return committed;
  }

  getDocument(recordingId: string): Promise<GuideDocumentSnapshot> {
    return this.repositories.documents.getSnapshot(recordingId);
  }

  /** Resolves only after the save transaction has committed. */
  async save(input: Input<"saveDocument">): Promise<SaveGuideDocumentResult> {
    const result = await this.repositories.documents.save(
      input.id,
      input.markdown,
      input.expectedSavedRevisionNumber,
      input.draftVersion,
    );

    if (result.status === "saved") this.publish(input.id);

    return result;
  }

  async saveDraft(input: Input<"saveDraft">): Promise<SaveGuideDraftResult> {
    const result = await this.repositories.documents.saveDraft(
      input.id,
      input.markdown,
      input.expectedDraftVersion,
    );

    if (result.status === "stored") this.publish(input.id);

    return result;
  }

  async discardDraft(input: Input<"discardDraft">): Promise<SaveGuideDraftResult> {
    const result = await this.repositories.documents.discardDraft(
      input.id,
      input.expectedDraftVersion,
    );

    if (result.status === "stored") this.publish(input.id);

    return result;
  }

  listRevisions(input: Input<"listRevisions">): Promise<DocumentRevisionPage> {
    return this.repositories.documents.listRevisions(input.id, input.beforeNumber, input.limit);
  }

  getRevision(input: Input<"getRevision">): Promise<DocumentRevision> {
    return this.repositories.documents.getRevision(input.id, input.number);
  }

  async restoreRevision(input: Input<"restoreRevision">): Promise<CommittedGuideRevision> {
    const committed = await this.repositories.documents.restoreRevision(
      input.id,
      input.number,
      input.replacedMarkdown,
    );

    this.publish(input.id);

    return committed;
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

  /** A committed change is already durable; a failed broadcast must not report it as failed. */
  private publish(recordingId: string): void {
    this.repositories.documents.getChange(recordingId).then(this.onChanged, (error: unknown) => {
      this.diagnostics.warn("Unable to broadcast a document change", error);
    });
  }
}
