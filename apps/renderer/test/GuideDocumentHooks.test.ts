// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PersistedGuide } from "@path/shared";
import { useGuideDocument } from "../src/hooks/useGuideDocument";

const mocks = vi.hoisted(() => ({
  generate: vi.fn<(input: { id: string; instructions: string }) => Promise<{ markdown: string }>>(),
  exportMarkdown: vi.fn<(input: { suggestedName: string; markdown: string }) => Promise<boolean>>(),
  getDocument: vi.fn<(input: { id: string }) => Promise<PersistedGuide | null>>(),
  saveDocument: vi.fn<(input: { id: string; markdown: string }) => Promise<PersistedGuide>>(),
  translate: (key: string) => key,
  desktopAvailable: true,
}));

vi.mock("next-intl", () => ({ useTranslations: () => mocks.translate }));
vi.mock("@/lib/Desktop", () => ({
  getDesktopApi: () =>
    mocks.desktopAvailable
      ? {
          guides: {
            generate: mocks.generate,
            exportMarkdown: mocks.exportMarkdown,
            getDocument: mocks.getDocument,
            saveDocument: mocks.saveDocument,
          },
        }
      : null,
}));

const recording = { id: "recording-one", title: "First recording" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.generate.mockReset();
  mocks.exportMarkdown.mockReset();
  mocks.getDocument.mockReset();
  mocks.saveDocument.mockReset();
  mocks.getDocument.mockResolvedValue(null);
  mocks.saveDocument.mockImplementation(async (input) => ({
    recordingId: input.id,
    title: recording.title,
    markdown: input.markdown,
    updatedAt: new Date().toISOString(),
  }));
  mocks.desktopAvailable = true;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("guide document workflow", () => {
  it("generates from the selected recording and instructions", async () => {
    mocks.generate.mockResolvedValue({ markdown: "# New guide" });
    const { result } = renderHook(() => useGuideDocument(recording));

    await act(() => result.current.generateGuide("Write a specification"));

    expect(mocks.generate).toHaveBeenCalledWith({
      id: recording.id,
      instructions: "Write a specification",
    });
    expect(result.current.markdown).toBe("# New guide");
    expect(result.current.generating).toBe(false);
  });

  it("discards generation from a previous recording without changing the new pending state", async () => {
    const old = Promise.withResolvers<{ markdown: string }>();
    const current = Promise.withResolvers<{ markdown: string }>();

    mocks.generate.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const { result, rerender } = renderHook((item) => useGuideDocument(item), {
      initialProps: recording,
    });

    let previousRequest: Promise<void>;

    act(() => {
      previousRequest = result.current.generateGuide("First instructions");
    });
    rerender({ id: "recording-two", title: "Second recording" });
    let currentRequest: Promise<void>;

    act(() => {
      currentRequest = result.current.generateGuide("Second instructions");
    });
    await act(async () => {
      old.resolve({ markdown: "Stale guide" });
      await previousRequest;
    });

    expect(result.current.markdown).toBe("");
    expect(result.current.generating).toBe(true);

    await act(async () => {
      current.resolve({ markdown: "Current guide" });
      await currentRequest;
    });

    expect(result.current.markdown).toBe("Current guide");
  });

  it("preserves text edited while generation is pending", async () => {
    const pending = Promise.withResolvers<{ markdown: string }>();

    mocks.generate.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useGuideDocument(recording));
    let request: Promise<void>;

    act(() => {
      request = result.current.generateGuide("Instructions");
    });
    act(() => result.current.editMarkdown("My manual edits"));
    await act(async () => {
      pending.resolve({ markdown: "Generated text" });
      await request;
    });

    expect(result.current.markdown).toBe("My manual edits");
    expect(result.current.generating).toBe(false);
  });

  it("leaves the new document's error clear when a previous export rejects", async () => {
    const pending = Promise.withResolvers<boolean>();

    mocks.exportMarkdown.mockReturnValue(pending.promise);
    const { result, rerender } = renderHook((item) => useGuideDocument(item), {
      initialProps: recording,
    });

    act(() => result.current.editMarkdown("Export me"));
    let request: Promise<void>;

    act(() => {
      request = result.current.exportMarkdown();
    });

    expect(mocks.exportMarkdown).toHaveBeenCalledWith({
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
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);

    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { result, unmount } = renderHook(() => useGuideDocument(recording));

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
    const { result } = renderHook(() => useGuideDocument(recording));

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

  it("clears previous copy feedback when a later clipboard request fails", async () => {
    const writeText = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Clipboard unavailable"));

    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { result } = renderHook(() => useGuideDocument(recording));

    act(() => result.current.editMarkdown("Document"));
    await act(() => result.current.copyMarkdown());

    expect(result.current.copied).toBe(true);

    await act(() => result.current.copyMarkdown());

    expect(result.current.copied).toBe(false);
    expect(result.current.error).toBe("Clipboard unavailable");
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
    const { result } = renderHook(() => useGuideDocument(recording));
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
      readers[0].dispatchEvent(new ProgressEvent("load"));
      await request;
    });

    expect(result.current.markdown).toBe("New typed text");
  });

  it("inserts image Markdown at the selected text and restores the insertion cursor", async () => {
    const frames: FrameRequestCallback[] = [];

    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);

      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const { result } = renderHook(() => useGuideDocument(recording));
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
    expect(result.current.error).toBeNull();

    act(() => {
      input.value = result.current.markdown;
      frames[0](0);
    });
    const insertionEnd = result.current.markdown.indexOf(" after");

    expect(input.selectionStart).toBe(insertionEnd);
    expect(input.selectionEnd).toBe(insertionEnd);
  });

  it("loads the persisted document and tracks dirty state through save", async () => {
    mocks.getDocument.mockResolvedValue({
      recordingId: recording.id,
      title: recording.title,
      markdown: "# Saved guide",
      updatedAt: "2026-09-20T00:00:00.000Z",
    });
    const { result } = renderHook(() => useGuideDocument(recording));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mocks.getDocument).toHaveBeenCalledWith({ id: recording.id });
    expect(result.current.markdown).toBe("# Saved guide");
    expect(result.current.isDirty).toBe(false);

    act(() => result.current.editMarkdown("# Edited guide"));

    expect(result.current.isDirty).toBe(true);

    let saved: boolean | undefined;

    await act(async () => {
      saved = await result.current.saveDocument();
    });

    expect(saved).toBe(true);
    expect(mocks.saveDocument).toHaveBeenCalledWith({
      id: recording.id,
      markdown: "# Edited guide",
    });
    expect(result.current.isDirty).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("reports a failed save without clearing the draft", async () => {
    mocks.saveDocument.mockRejectedValue(new Error("Disk unavailable"));
    const { result } = renderHook(() => useGuideDocument(recording));

    await waitFor(() => expect(result.current.loading).toBe(false));

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
    mocks.generate.mockRejectedValue(new Error("No model"));
    const { result } = renderHook(() => useGuideDocument(recording));

    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.generateGuide("Instructions"));

    expect(result.current.error).toBe("No model");
    expect(result.current.canRetryGenerate).toBe(true);

    act(() => result.current.editMarkdown("Manual fix"));

    expect(result.current.canRetryGenerate).toBe(false);
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

    const { result, unmount } = renderHook(() => useGuideDocument(recording));

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
