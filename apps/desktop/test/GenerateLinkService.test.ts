import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseInstructionFlowState, type RecordingSession } from "@path/shared";
import { GenerateLinkService } from "../src/links/GenerateLinkService";
import type { PathGenerateLink } from "../src/links/PathAppLink";

type Dependencies = ConstructorParameters<typeof GenerateLinkService>[0];
const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function setup(overrides: Partial<PathGenerateLink> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "path-generate-link-"));

  directories.push(directory);
  const videoPath = join(directory, "walkthrough.mp4");

  await writeFile(videoPath, "fixture-video");
  const link: PathGenerateLink = {
    route: "generate",
    videoPath,
    title: "Walkthrough",
    type: null,
    documentType: null,
    folder: null,
    auto: false,
    logPath: null,
    elementsPath: null,
    ...overrides,
  };

  const events: string[] = [];
  const state = parseInstructionFlowState(null);
  const session = {
    id: "recording",
    status: "ready",
    transcriptStatus: "ready",
  } as RecordingSession;

  const recording = {
    importVideo: vi.fn<Dependencies["recording"]["importVideo"]>(async (_input, onProcessing) => {
      events.push("video");
      onProcessing?.("recording");

      return "recording";
    }),
  };

  const projects = {
    list: vi.fn<Dependencies["projects"]["list"]>(async () => []),
    moveToNamedProject: vi.fn<Dependencies["projects"]["moveToNamedProject"]>(async () => {}),
  };

  const documents = {
    generate: vi.fn<Dependencies["documents"]["generate"]>(async () => {
      events.push("document");

      return { markdown: "# Guide", revision: { number: 1 } } as Awaited<
        ReturnType<Dependencies["documents"]["generate"]>
      >;
    }),
  };

  const timelineImports = {
    importFile: vi.fn<Dependencies["timelineImports"]["importFile"]>(
      async (_id, kind, chooseFile) => {
        expect(await chooseFile()).toBeTruthy();
        events.push(kind);

        return {
          status: "imported",
          timelineImport: {
            kind,
            fileName: "events.txt",
            offsetMs: 0,
            importedAt: new Date().toISOString(),
            rowCount: 1,
            entryCount: 1,
            outsideCount: 0,
            unreadableLineCount: 0,
          },
        };
      },
    ),
  };

  const notify = vi.fn<Dependencies["notify"]>((phase) => {
    events.push(phase);
  });

  const openRecording = vi.fn<Dependencies["openRecording"]>();
  const service = new GenerateLinkService({
    recording,
    projects,
    documents,
    timelineImports,
    notify,
    openRecording,
    recordings: { get: async () => session },
    instructionFlows: { get: () => state },
    settings: {
      get: () =>
        ({ timelineImports: { maxFileSizeMb: 1 } }) as ReturnType<Dependencies["settings"]["get"]>,
    },
  });

  return {
    service,
    link,
    recording,
    projects,
    documents,
    timelineImports,
    notify,
    openRecording,
    directory,
    events,
    state,
    session,
  };
}

describe("GenerateLinkService", () => {
  it("imports without document generation by default and reports each stage", async () => {
    const { service, link, documents, events, openRecording } = await setup();

    await service.generate(link);
    expect(events).toEqual(["starting", "video", "processing", "complete"]);
    expect(documents.generate).not.toHaveBeenCalled();
    expect(openRecording).toHaveBeenCalledWith("recording");
  });

  it("waits for video, activity and both imports before generating with an edited built-in prompt", async () => {
    const { service, link, directory, documents, events, state, projects } = await setup({
      auto: true,
      documentType: "spec",
      folder: "Work",
    });

    state.builtInOverrides.push({
      id: "spec-document",
      instructions: "My spec instructions",
      icon: "file-code",
    });
    link.logPath = join(directory, "logs.txt");
    link.elementsPath = join(directory, "elements.txt");
    await writeFile(link.logPath, "log");
    await writeFile(link.elementsPath, "element");
    await service.generate(link);
    expect(events).toEqual([
      "starting",
      "video",
      "processing",
      "log",
      "element",
      "document",
      "complete",
    ]);
    expect(documents.generate).toHaveBeenCalledWith({
      id: "recording",
      instructions: "My spec instructions",
    });
    expect(projects.moveToNamedProject).toHaveBeenCalledExactlyOnceWith("recording", "Work");
    expect(state.selectedId).toBe("help-guide");
  });

  it("resolves custom prompt names and reuses the named folder", async () => {
    const { service, link, documents, state, projects } = await setup({
      auto: true,
      documentType: "Release Notes",
      folder: "work",
    });

    state.customFlows.push({
      id: "custom-notes",
      name: "Release Notes",
      instructions: "Write release notes",
      icon: "file-text",
    });
    projects.list.mockResolvedValue([{ id: "existing", name: "Work", recordingIds: [] }]);
    await service.generate(link);
    expect(documents.generate).toHaveBeenCalledWith({
      id: "recording",
      instructions: "Write release notes",
    });
    expect(projects.moveToNamedProject).toHaveBeenCalledExactlyOnceWith("recording", "work");
  });

  it("uses the selected prompt when documentType is omitted", async () => {
    const { service, link, documents, state } = await setup({ auto: true });

    state.selectedId = "help-guide";
    state.builtInOverrides.push({
      id: "help-guide",
      instructions: "Edited help",
      icon: "book-open",
    });
    await service.generate(link);
    expect(documents.generate).toHaveBeenCalledWith({
      id: "recording",
      instructions: "Edited help",
    });
  });

  it("rejects unknown prompts, missing files and duplicate folder names before creating a recording", async () => {
    const { service, link, recording, projects, directory } = await setup({
      documentType: "Missing",
    });

    await expect(service.generate(link)).rejects.toThrow("prompt does not exist");
    link.documentType = null;
    link.logPath = join(directory, "missing.log");
    await expect(service.generate(link)).rejects.toThrow("logPath could not be read");
    link.logPath = null;
    link.folder = "Work";
    projects.list.mockResolvedValue([
      { id: "a", name: "Work", recordingIds: [] },
      { id: "b", name: "work", recordingIds: [] },
    ]);
    await expect(service.generate(link)).rejects.toThrow("More than one");
    expect(recording.importVideo).not.toHaveBeenCalled();
  });

  it("checks import size limits before processing a video", async () => {
    const { service, link, directory, recording } = await setup();

    link.logPath = join(directory, "large.log");
    await writeFile(link.logPath, Buffer.alloc(1024 * 1024 + 1));
    await expect(service.generate(link)).rejects.toThrow("1 MB import limit");
    expect(recording.importVideo).not.toHaveBeenCalled();
  });

  it("keeps the recording for review and does not claim completion after an import fails", async () => {
    const { service, link, directory, timelineImports, documents, notify, openRecording } =
      await setup({ auto: true });

    link.logPath = join(directory, "invalid.log");
    await writeFile(link.logPath, "unreadable");
    timelineImports.importFile.mockResolvedValue({ status: "no-rows" });
    await expect(service.generate(link)).rejects.toThrow("no readable timestamped rows");
    expect(documents.generate).not.toHaveBeenCalled();
    expect(notify.mock.calls.some(([phase]) => phase === "complete")).toBe(false);
    expect(openRecording).toHaveBeenCalledWith("recording");
  });

  it("does not auto-generate after failed activity processing", async () => {
    const { service, link, session, documents, openRecording } = await setup({ auto: true });

    session.transcriptStatus = "failed";
    await expect(service.generate(link)).rejects.toThrow("activity processing did not finish");
    expect(documents.generate).not.toHaveBeenCalled();
    expect(openRecording).toHaveBeenCalledWith("recording");
  });

  it("retains and opens the recording when the selected AI provider fails", async () => {
    const { service, link, documents, notify, openRecording } = await setup({ auto: true });

    documents.generate.mockRejectedValue(new Error("Provider unavailable"));
    await expect(service.generate(link)).rejects.toThrow("Provider unavailable");
    expect(notify.mock.calls.some(([phase]) => phase === "complete")).toBe(false);
    expect(openRecording).toHaveBeenCalledWith("recording");
  });

  it("opens a retained recording when video processing fails after import", async () => {
    const { service, link, recording, openRecording, notify } = await setup();

    recording.importVideo.mockImplementation(async (_input, onProcessing) => {
      onProcessing?.("retained-recording");

      throw new Error("Video conversion failed");
    });
    await expect(service.generate(link)).rejects.toThrow("Video conversion failed");
    expect(openRecording).toHaveBeenCalledWith("retained-recording");
    expect(notify.mock.calls.some(([phase]) => phase === "complete")).toBe(false);
  });
});
