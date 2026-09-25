import { realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { resolveInstructionFlows } from "@path/shared";
import type { GuideDocumentService } from "../documents/GuideDocumentService";
import type { RecordingController } from "../recording/RecordingController";
import type { TimelineImportService } from "../recording/TimelineImportService";
import type { DesktopSettingsService } from "../settings/DesktopSettingsService";
import type { InstructionFlowService } from "../settings/InstructionFlowService";
import type { RemoteRepositories } from "../storage/DatabaseClient";
import type { PathGenerateLink } from "./PathAppLink";

interface GenerateLinkDependencies {
  recording: Pick<RecordingController, "importVideo">;
  recordings: Pick<RemoteRepositories["recordings"], "get">;
  projects: Pick<RemoteRepositories["projects"], "list" | "moveToNamedProject">;
  documents: Pick<GuideDocumentService, "generate">;
  timelineImports: Pick<TimelineImportService, "importFile">;
  instructionFlows: Pick<InstructionFlowService, "get">;
  settings: Pick<DesktopSettingsService, "get">;
  notify: (
    phase: "starting" | "processing" | "complete",
    title: string,
    recordingId?: string,
  ) => void;
  openRecording: (recordingId: string) => void;
}

/** Runs an accepted link through the same storage, analysis, and document owners as the UI. */
export class GenerateLinkService {
  constructor(private readonly dependencies: GenerateLinkDependencies) {}

  async generate(link: PathGenerateLink): Promise<void> {
    const { recording, recordings, projects, documents, timelineImports, settings } =
      this.dependencies;

    const instructions = this.resolveInstructions(link.documentType);
    const videoPath = await requireLocalFile(link.videoPath, "videoPath");
    const maxBytes = settings.get().timelineImports.maxFileSizeMb * 1024 * 1024;
    const logPath = link.logPath ? await requireLocalFile(link.logPath, "logPath", maxBytes) : null;
    const elementsPath = link.elementsPath
      ? await requireLocalFile(link.elementsPath, "elementsPath", maxBytes)
      : null;

    // Resolve ambiguous names before creating media or invoking an AI provider.
    const matchingFolders = link.folder
      ? (await projects.list()).filter((project) => sameName(project.name, link.folder!))
      : [];

    if (matchingFolders.length > 1) {
      throw new Error("More than one Projects folder has this name. Rename one before importing.");
    }

    this.dependencies.notify("starting", link.title);
    let recordingId: string | null = null;

    try {
      recordingId = await recording.importVideo({ videoPath, title: link.title }, (id) => {
        recordingId = id;
        this.dependencies.notify("processing", link.title, id);
      });

      if (link.folder) {
        // Resolve again transactionally: folder names may change while the video processes.
        await projects.moveToNamedProject(recordingId, link.folder);
      }

      for (const [kind, path] of [
        ["log", logPath],
        ["element", elementsPath],
      ] as const) {
        if (!path) continue;

        const result = await timelineImports.importFile(recordingId, kind, async () => path);

        if (result.status === "too-large") {
          throw new Error(`The ${kind} file exceeds the ${result.maxFileSizeMb} MB import limit.`);
        }

        if (result.status !== "imported") {
          throw new Error(`The ${kind} file contains no readable timestamped rows.`);
        }

        if (link.auto && result.timelineImport.entryCount === 0) {
          throw new Error(
            `The ${kind} rows do not overlap the video. Adjust the import offset before generating.`,
          );
        }
      }

      if (link.auto) {
        const session = await recordings.get(recordingId);

        if (session?.status !== "ready" || session.transcriptStatus !== "ready") {
          throw new Error(
            "The video was imported, but activity processing did not finish. Review the recording before generating.",
          );
        }

        await documents.generate({ id: recordingId, instructions });
      }

      this.dependencies.notify("complete", link.title, recordingId);
    } finally {
      // Failed imports/generation retain the playable recording for review and manual recovery.
      if (recordingId) this.dependencies.openRecording(recordingId);
    }
  }

  private resolveInstructions(documentType: string | null): string {
    const state = this.dependencies.instructionFlows.get();
    const flows = resolveInstructionFlows(state);
    const requested = documentType?.toLocaleLowerCase();
    const builtInId =
      requested === "spec" ? "spec-document" : requested === "help" ? "help-guide" : null;

    const flow =
      documentType === null
        ? flows.find((candidate) => candidate.id === state.selectedId)
        : flows.find((candidate) =>
            builtInId ? candidate.id === builtInId : sameName(candidate.name, documentType),
          );

    if (!flow) throw new Error("The requested document prompt does not exist in Settings.");

    return flow.instructions;
  }
}

function sameName(left: string, right: string): boolean {
  return left.toLocaleLowerCase() === right.toLocaleLowerCase();
}

async function requireLocalFile(path: string, field: string, maxBytes?: number): Promise<string> {
  // The URL parser validates syntax; resolve aliases again at the I/O boundary on this OS.
  if (!isAbsolute(path) || (process.platform === "win32" && !/^[a-z]:[\\/]/i.test(path))) {
    throw new Error(`${field} must be an absolute local file path on this computer.`);
  }

  let resolved: string;
  let file;

  try {
    resolved = await realpath(path);
    file = await stat(resolved);
  } catch {
    throw new Error(`${field} could not be read. Check that the file exists and is accessible.`);
  }

  if (
    resolved.startsWith("\\\\") ||
    resolved.startsWith("//") ||
    !file.isFile() ||
    file.size === 0
  ) {
    throw new Error(`${field} must point to a nonempty local file.`);
  }

  if (maxBytes !== undefined && file.size > maxBytes) {
    throw new Error(`${field} exceeds the configured ${maxBytes / 1024 / 1024} MB import limit.`);
  }

  return resolved;
}
