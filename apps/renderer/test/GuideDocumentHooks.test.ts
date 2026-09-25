// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommittedGuideRevision, GuideContextItem } from "@path/shared";
import { DRAFT_AUTOSAVE_DELAY_MS, useGuideDocument } from "../src/hooks/useGuideDocument";
import { createGuideDocumentStore, type GuideDocumentStore } from "./GuideDocumentStoreFixture";

const mocks = vi.hoisted(() => ({
  store: null as unknown as GuideDocumentStore,
  translate: (key: string) => key,
  desktopAvailable: true,
}));

vi.mock("next-intl", () => ({ useTranslations: () => mocks.translate }));
vi.mock("@/lib/Desktop", () => ({
  getDesktopApi: () =>
    mocks.desktopAvailable ? { guides: mocks.store.guides, app: mocks.store.app } : null,
}));

const recording = { id: "recording-one", title: "First recording" };

beforeEach(() => {
  mocks.store = createGuideDocumentStore(recording.id);
  mocks.desktopAvailable = true;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function loadedHook(item = recording) {
  const view = renderHook((current) => useGuideDocument(current), { initialProps: item });

  await waitFor(() => expect(view.result.current.loading).toBe(false));

  return view;
}

function committed(markdown: string, number = 1): CommittedGuideRevision {
  return {
    markdown,
    revision: {
      number,
      kind: "generated",
      createdAt: "",
      characterCount: 0,
      restoredFromNumber: null,
    },
  };
}

describe("guide document workflow", () => {
  it("generates from the selected recording and instructions", async () => {
    const { result } = await loadedHook();

    await act(() => result.current.generateGuide("Write a specification"));

    expect(mocks.store.guides.generate).toHaveBeenCalledWith({
      id: recording.id,
      instructions: "Write a specification",
    });
    expect(result.current.markdown).toBe("# Generated");
    expect(result.current.generating).toBe(false);
    // Generation is durable history but is not an explicit save.
    expect(result.current.isDirty).toBe(true);
    await waitFor(() => expect(result.current.revisions.map((r) => r.kind)).toEqual(["generated"]));
  });

  it("discards generation from a previous recording without changing the new pending state", async () => {
    const old = Promise.withResolvers<CommittedGuideRevision>();
    const current = Promise.withResolvers<CommittedGuideRevision>();

    vi.mocked(mocks.store.guides.generate)
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(current.promise);
    const { result, rerender } = await loadedHook();

    let previousRequest: Promise<void>;

    act(() => {
      previousRequest = result.current.generateGuide("First instructions");
    });
    rerender({ id: "recording-two", title: "Second recording" });
    await waitFor(() => expect(result.current.loading).toBe(false));
    let currentRequest: Promise<void>;

    act(() => {
      currentRequest = result.current.generateGuide("Second instructions");
    });
    await act(async () => {
      old.resolve(committed("Stale guide"));
      await previousRequest;
    });

    expect(result.current.markdown).toBe("");
    expect(result.current.generating).toBe(true);

    await act(async () => {
      current.resolve(committed("Current guide", 2));
      await currentRequest;
    });

    expect(result.current.markdown).toBe("Current guide");
  });

  it("keeps text edited while generation is pending and leaves the result in history", async () => {
    const pending = Promise.withResolvers<CommittedGuideRevision>();

    vi.mocked(mocks.store.guides.generate).mockReturnValue(pending.promise);
    const { result } = await loadedHook();
    let request: Promise<void>;

    act(() => {
      request = result.current.generateGuide("Instructions");
    });
    act(() => result.current.editMarkdown("My manual edits"));
    await act(async () => {
      pending.resolve(committed("Generated text"));
      await request;
    });

    expect(result.current.markdown).toBe("My manual edits");
    expect(result.current.generating).toBe(false);
    expect(result.current.notice).toBe("guide.resultKeptInHistory");
  });

  it("checkpoints the text a generation replaces", async () => {
    const { result } = await loadedHook();

    act(() => result.current.editMarkdown("# Hand-written notes"));
    await act(() => result.current.generateGuide("Instructions"));

    expect(mocks.store.guides.generate).toHaveBeenCalledWith(
      expect.objectContaining({ replacedMarkdown: "# Hand-written notes" }),
    );
    expect(mocks.store.state.revisions.map((revision) => revision.kind)).toEqual([
      "checkpoint",
      "generated",
    ]);
  });

  it("leaves the new document's error clear when a previous export rejects", async () => {
    const pending = Promise.withResolvers<boolean>();

    vi.mocked(mocks.store.guides.exportMarkdown).mockReturnValue(pending.promise);
    const { result, rerender } = await loadedHook();

    act(() => result.current.editMarkdown("Export me"));
    let request: Promise<void>;

    act(() => {
      request = result.current.exportMarkdown();
    });

    expect(mocks.store.guides.exportMarkdown).toHaveBeenCalledWith({
      suggestedName: recording.title,
      markdown: "Export me",
    });

    rerender({ id: "recording-two", title: "Second recording" });
    await act(async () => {
      pending.reject(new Error("Export failed"));
      await request;
    });

    expect(result.current.error).toBeNull();
    expect(result.current.exporting).toBe(false);
  });

  it("restarts clipboard feedback and clears its timer on unmount", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { result, unmount } = await loadedHook();

    vi.useFakeTimers();
    act(() => result.current.editMarkdown("Copy me"));
    await act(() => result.current.copyMarkdown());
    act(() => vi.advanceTimersByTime(1_000));
    await act(() => result.current.copyMarkdown());
    act(() => vi.advanceTimersByTime(1_000));

    expect(result.current.copied).toBe(true);

    act(() => vi.advanceTimersByTime(1_000));

    expect(result.current.copied).toBe(false);

    await act(() => result.current.copyMarkdown());
    unmount();

    expect(vi.getTimerCount()).toBe(0);
    expect(writeText).toHaveBeenCalledWith("Copy me");
  });

  it("ignores a clipboard completion after the document changes", async () => {
    const pending = Promise.withResolvers<void>();

    vi.stubGlobal("navigator", { clipboard: { writeText: () => pending.promise } });
    const { result } = await loadedHook();

    act(() => result.current.editMarkdown("Original text"));
    let request: Promise<void>;

    act(() => {
      request = result.current.copyMarkdown();
    });
    act(() => result.current.editMarkdown("New text"));
    await act(async () => {
      pending.resolve();
      await request;
    });

    expect(result.current.copied).toBe(false);
  });

  it("copies rich formatted HTML and plain text when ClipboardItem is available", async () => {
    const write = vi.fn().mockResolvedValue(undefined);

    class MockClipboardItem {
      data: Record<string, Blob>;

      constructor(data: Record<string, Blob>) {
        this.data = data;
      }
    }

    vi.stubGlobal("ClipboardItem", MockClipboardItem);
    vi.stubGlobal("navigator", { clipboard: { write } });
    const { result } = await loadedHook();

    act(() => result.current.editMarkdown("# Guide Title\n\n1. First step"));
    await act(() => result.current.copyMarkdown());

    const item = write.mock.calls[0]?.[0]?.[0] as MockClipboardItem;

    expect(result.current.copied).toBe(true);
    expect(item.data["text/plain"]).toBeDefined();
    expect(item.data["text/html"]).toBeDefined();
  });

  it("revokes a browser export URL even when the download fails", async () => {
    mocks.desktopAvailable = false;
    const createObjectURL = vi.fn().mockReturnValue("blob:guide-test");
    const revokeObjectURL = vi.fn();

    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      throw new Error("Download failed");
    });
    const { result } = renderHook(() => useGuideDocument(recording));

    act(() => result.current.editMarkdown("Document"));
    await act(() => result.current.exportMarkdown());

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:guide-test");
    expect(result.current.error).toBe("Download failed");
    expect(result.current.exporting).toBe(false);
  });

  it("discards image insertion if the captured text selection becomes stale", async () => {
    const readers: FileReader[] = [];

    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) {
      readers.push(this);
    });
    const { result } = await loadedHook();
    const input = document.createElement("textarea");

    act(() => {
      result.current.markdownInputRef.current = input;
      result.current.editMarkdown("Original");
    });
    let request: Promise<void>;

    act(() => {
      request = result.current.insertImages([
        new File(["image"], "image.png", { type: "image/png" }),
      ]);
    });
    act(() => result.current.editMarkdown("New typed text"));
    await act(async () => {
      Object.defineProperty(readers[0], "result", { value: "data:image/png;base64,eA==" });
      readers[0]!.dispatchEvent(new ProgressEvent("load"));
      await request;
    });

    expect(result.current.markdown).toBe("New typed text");
  });

  it("inserts image Markdown at the selected text and restores the insertion cursor", async () => {
    const frames: FrameRequestCallback[] = [];
    const { result } = await loadedHook();

    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);

      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const input = document.createElement("textarea");

    input.value = "Before replace after";
    input.setSelectionRange(7, 14);
    act(() => {
      result.current.markdownInputRef.current = input;
      result.current.editMarkdown(input.value);
    });
    await act(() =>
      result.current.insertImages([new File(["image"], "[shot].png", { type: "image/png" })]),
    );

    expect(result.current.markdown).toBe("Before ![shot](data:image/png;base64,aW1hZ2U=) after");

    act(() => {
      input.value = result.current.markdown;
      frames[0]!(0);
    });
    const insertionEnd = result.current.markdown.indexOf(" after");

    expect(input.selectionStart).toBe(insertionEnd);
    expect(input.selectionEnd).toBe(insertionEnd);
  });

  it("loads the saved document, tracks dirty state, and acknowledges a committed save", async () => {
    mocks.store.state.savedRevisionNumber = mocks.store.append("saved", "# Saved guide").number;
    mocks.store.state.savedAt = "2026-09-20T00:00:00.000Z";
    const { result } = await loadedHook();

    expect(mocks.store.guides.getDocument).toHaveBeenCalledWith({ id: recording.id });
    expect(result.current.markdown).toBe("# Saved guide");
    expect(result.current.isDirty).toBe(false);

    act(() => result.current.editMarkdown("# Edited guide"));

    expect(result.current.isDirty).toBe(true);

    let saved: boolean | undefined;

    await act(async () => {
      saved = await result.current.saveDocument();
    });

    expect(saved).toBe(true);
    expect(mocks.store.guides.saveDocument).toHaveBeenCalledWith({
      id: recording.id,
      markdown: "# Edited guide",
      expectedSavedRevisionNumber: 1,
      draftVersion: 0,
    });
    expect(result.current.isDirty).toBe(false);
    expect(result.current.savedRevisionNumber).toBe(2);
    expect(result.current.error).toBeNull();
  });

  it("reports a failed save without clearing the text", async () => {
    vi.mocked(mocks.store.guides.saveDocument).mockRejectedValue(new Error("Disk unavailable"));
    const { result } = await loadedHook();

    act(() => result.current.editMarkdown("# Draft"));

    let saved: boolean | undefined;

    await act(async () => {
      saved = await result.current.saveDocument();
    });

    expect(saved).toBe(false);
    expect(result.current.error).toBe("Disk unavailable");
    expect(result.current.isDirty).toBe(true);
    expect(result.current.markdown).toBe("# Draft");
  });

  it("marks a failed generation as retryable until the next edit", async () => {
    vi.mocked(mocks.store.guides.generate).mockRejectedValue(new Error("No model"));
    const { result } = await loadedHook();

    await act(() => result.current.generateGuide("Instructions"));

    expect(result.current.error).toBe("No model");
    expect(result.current.canRetryGenerate).toBe(true);

    act(() => result.current.editMarkdown("Manual fix"));

    expect(result.current.canRetryGenerate).toBe(false);
  });

  it("updates with the current text and original instructions as context", async () => {
    const { result } = await loadedHook();

    act(() => result.current.editMarkdown("# Current guide"));
    await act(() => result.current.updateGuide("Write a specification", "  Add examples  "));

    expect(mocks.store.guides.update).toHaveBeenCalledWith({
      id: recording.id,
      instructions: "Write a specification",
      currentMarkdown: "# Current guide",
      updatePrompt: "Add examples",
    });
    expect(result.current.markdown).toBe("# Updated");
    expect(result.current.updating).toBe(false);
    await waitFor(() =>
      expect(result.current.revisions.map((revision) => revision.kind)).toEqual([
        "ai-update",
        "checkpoint",
      ]),
    );
  });

  it("passes attached context and the context folder through to the desktop update", async () => {
    const { result } = await loadedHook();
    const context: GuideContextItem[] = [{ kind: "text", text: "Reference" }];

    await act(() => result.current.updateGuide("Instructions", "Update", context, "folder"));
    expect(mocks.store.guides.update).toHaveBeenCalledWith(
      expect.objectContaining({ context, contextFolder: "folder" }),
    );
  });

  it("blocks generation while an update is pending and reports update failures plainly", async () => {
    const pending = Promise.withResolvers<CommittedGuideRevision>();

    vi.mocked(mocks.store.guides.update).mockReturnValue(pending.promise);
    const { result } = await loadedHook();
    let request: Promise<boolean>;

    act(() => {
      request = result.current.updateGuide("Instructions", "Add examples");
    });
    await act(() => result.current.generateGuide("Instructions"));

    expect(result.current.updating).toBe(true);
    expect(mocks.store.guides.generate).not.toHaveBeenCalled();

    await act(async () => {
      pending.reject(new Error("Model unavailable"));
      await request;
    });

    expect(result.current.error).toBe("Model unavailable");
    expect(result.current.canRetryGenerate).toBe(false);
    expect(result.current.updating).toBe(false);
  });

  it("aborts pending image readers when the recording is unmounted", async () => {
    const readers: FileReader[] = [];

    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) {
      readers.push(this);
    });
    const abort = vi.spyOn(FileReader.prototype, "abort").mockImplementation(function (
      this: FileReader,
    ) {
      this.dispatchEvent(new ProgressEvent("abort"));
    });

    const { result, unmount } = await loadedHook();

    act(() => {
      result.current.markdownInputRef.current = document.createElement("textarea");
    });
    let request: Promise<void>;

    act(() => {
      request = result.current.insertImages([
        new File(["image"], "image.png", { type: "image/png" }),
      ]);
    });
    unmount();
    await act(async () => {
      await request;
    });

    expect(readers).toHaveLength(1);
    expect(abort).toHaveBeenCalledOnce();
  });
});

describe("recovery drafts", () => {
  it("writes a draft once typing pauses, never on every keystroke", async () => {
    const { result } = await loadedHook();

    vi.useFakeTimers();
    for (const text of ["#", "# G", "# Gu", "# Guide"]) {
      act(() => result.current.editMarkdown(text));
      act(() => vi.advanceTimersByTime(DRAFT_AUTOSAVE_DELAY_MS / 2));
    }

    expect(mocks.store.guides.saveDraft).not.toHaveBeenCalled();
    expect(result.current.draftStatus).toBe("pending");

    await act(async () => {
      vi.advanceTimersByTime(DRAFT_AUTOSAVE_DELAY_MS);
    });
    vi.useRealTimers();

    await waitFor(() => expect(result.current.draftStatus).toBe("stored"));
    expect(mocks.store.guides.saveDraft).toHaveBeenCalledOnce();
    expect(mocks.store.guides.saveDraft).toHaveBeenCalledWith({
      id: recording.id,
      markdown: "# Guide",
      expectedDraftVersion: 0,
    });
    // A stored draft is not a save.
    expect(result.current.isDirty).toBe(true);
    expect(mocks.store.state.savedRevisionNumber).toBeNull();
  });

  it("returns to a clean status without a write when edits are undone before the delay", async () => {
    const { result } = await loadedHook();

    act(() => result.current.editMarkdown("# Typo"));
    expect(result.current.draftStatus).toBe("pending");

    act(() => result.current.editMarkdown(""));

    expect(result.current.draftStatus).toBe("clean");
    await act(() => mocks.store.requestFlush());
    expect(mocks.store.guides.saveDraft).not.toHaveBeenCalled();
  });

  it("recovers unsaved text after a restart, marked as unsaved", async () => {
    mocks.store.state.savedRevisionNumber = mocks.store.append("saved", "# Saved").number;
    mocks.store.state.savedAt = "2026-09-20T00:00:00.000Z";
    mocks.store.state.draft = "# Saved\n\nTyped before the crash";
    mocks.store.state.draftVersion = 4;

    const { result } = await loadedHook();

    expect(result.current.markdown).toBe("# Saved\n\nTyped before the crash");
    expect(result.current.savedMarkdown).toBe("# Saved");
    expect(result.current.isDirty).toBe(true);
    expect(result.current.isRecoveredDraft).toBe(true);
    expect(result.current.draftStatus).toBe("stored");
  });

  it("writes pending text when main asks windows to flush before quitting", async () => {
    const { result } = await loadedHook();

    act(() => result.current.editMarkdown("# Unsaved at quit"));
    await act(() => mocks.store.requestFlush());

    expect(mocks.store.state.draft).toBe("# Unsaved at quit");
  });

  it("writes pending text when the editor switches to another recording", async () => {
    const { result, rerender } = await loadedHook();

    act(() => result.current.editMarkdown("# Left behind"));
    rerender({ id: "recording-two", title: "Second recording" });

    await waitFor(() => expect(mocks.store.state.draft).toBe("# Left behind"));
  });

  it("discards unsaved text durably so it does not return", async () => {
    const { result } = await loadedHook();

    act(() => result.current.editMarkdown("# Throw away"));
    await act(() => mocks.store.requestFlush());

    let discarded: boolean | undefined;

    await act(async () => {
      discarded = await result.current.discardChanges();
    });

    expect(discarded).toBe(true);
    expect(mocks.store.state.draft).toBeNull();
  });

  it("stops autosaving after another editor writes a newer draft", async () => {
    const { result } = await loadedHook();

    // Another window stores its own draft first.
    mocks.store.state.draft = "# Other window";
    mocks.store.state.draftVersion = 1;

    act(() => result.current.editMarkdown("# This window"));
    await act(() => mocks.store.requestFlush());

    expect(result.current.draftStatus).toBe("conflict");
    expect(result.current.error).toBe("guide.draftConflict");
    expect(mocks.store.state.draft).toBe("# Other window");
    expect(result.current.markdown).toBe("# This window");
  });
});

describe("explicit saves and history", () => {
  it("tracks which version the editor text came from and when it was last saved", async () => {
    mocks.store.state.savedRevisionNumber = mocks.store.append("saved", "# Saved").number;
    mocks.store.state.savedAt = "2026-09-20T00:00:00.000Z";
    const { result } = await loadedHook();

    expect(result.current.currentRevisionNumber).toBe(1);
    expect(result.current.savedAt).toBe("2026-09-20T00:00:00.000Z");

    await act(() => result.current.generateGuide("Instructions"));

    expect(result.current.currentRevisionNumber).toBe(2);
    expect(result.current.savedAt).toBe("2026-09-20T00:00:00.000Z");

    await act(async () => {
      await result.current.saveDocument();
    });

    // Saving text identical to version 2 marks that version saved.
    expect(result.current.currentRevisionNumber).toBe(2);
    expect(result.current.savedRevisionNumber).toBe(2);
    expect(result.current.savedAt).toBe(mocks.store.state.savedAt);
  });

  it("rejects a save based on an outdated revision, then saves deliberately on retry", async () => {
    const { result } = await loadedHook();

    // Another window saves after this editor loaded.
    mocks.store.state.savedRevisionNumber = mocks.store.append("saved", "# Other").number;
    mocks.store.state.savedAt = "2026-09-20T00:00:00.000Z";

    act(() => result.current.editMarkdown("# Mine"));

    let saved: boolean | undefined;

    await act(async () => {
      saved = await result.current.saveDocument();
    });

    expect(saved).toBe(false);
    expect(result.current.error).toBe("guide.saveConflict");
    expect(result.current.markdown).toBe("# Mine");

    await act(async () => {
      saved = await result.current.saveDocument();
    });

    expect(saved).toBe(true);
    expect(mocks.store.state.revisions.map((revision) => revision.markdown)).toEqual([
      "# Other",
      "# Mine",
    ]);
  });

  it("previews a revision read-only and restores it as a new revision", async () => {
    mocks.store.append("generated", "# First");
    mocks.store.append("generated", "# Second");
    const { result } = await loadedHook();

    await waitFor(() => expect(result.current.revisions).toHaveLength(2));
    act(() => result.current.editMarkdown("# Current edits"));
    await act(() => result.current.previewRevision(1));

    expect(result.current.preview).toEqual({ number: 1, markdown: "# First" });

    // The editor text is untouched while previewing.
    act(() => result.current.editMarkdown("ignored"));
    expect(result.current.markdown).toBe("# Current edits");

    await act(async () => {
      await result.current.restoreRevision(1);
    });

    expect(result.current.preview).toBeNull();
    expect(result.current.markdown).toBe("# First");
    expect(mocks.store.guides.restoreRevision).toHaveBeenCalledWith({
      id: recording.id,
      number: 1,
      replacedMarkdown: "# Current edits",
    });
    expect(mocks.store.state.revisions.map((revision) => revision.kind)).toEqual([
      "generated",
      "generated",
      "checkpoint",
      "restored",
    ]);
  });

  it("pages older revisions on request", async () => {
    for (let index = 1; index <= 60; index += 1) mocks.store.append("generated", `# ${index}`);

    const { result } = await loadedHook();

    await waitFor(() => expect(result.current.revisions).toHaveLength(50));
    expect(result.current.hasOlderRevisions).toBe(true);

    await act(() => result.current.loadOlderRevisions());

    expect(result.current.revisions).toHaveLength(60);
    expect(result.current.revisions.at(-1)?.number).toBe(1);
    expect(result.current.hasOlderRevisions).toBe(false);
  });

  it("follows a newer save from another window when this editor has no unsaved text", async () => {
    const { result } = await loadedHook();

    mocks.store.state.savedRevisionNumber = mocks.store.append("saved", "# Saved elsewhere").number;
    mocks.store.state.savedAt = "2026-09-20T00:00:00.000Z";
    act(() => mocks.store.broadcast());

    await waitFor(() => expect(result.current.markdown).toBe("# Saved elsewhere"));
    expect(result.current.isDirty).toBe(false);
  });
});
