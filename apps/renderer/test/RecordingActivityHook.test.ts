// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClickAnalysisResult, ClickEvent, TranscriptSegment } from "@path/shared";
import { useRecordingActivity } from "../src/hooks/useRecordingActivity";
import { capturedClick, transcriptSegment } from "./WorkspaceFixtures";

const bridge = vi.hoisted(() => ({
  listClicks: vi.fn(),
  listTranscript: vi.fn(),
  analyzeClicks: vi.fn(),
  updateTranscript: vi.fn(),
  updateClick: vi.fn(),
  deleteTranscript: vi.fn(),
  deleteClick: vi.fn(),
  revealScreenshot: vi.fn(),
}));

vi.mock("@/lib/Desktop", () => ({ getDesktopApi: () => ({ recordings: bridge }) }));

const messages = {
  analysisFailed: "Analysis failed",
  editFailed: "Edit failed",
  removeFailed: "Remove failed",
  revealFailed: "Reveal failed",
};

const renderActivity = (recordingId = "recording-a") =>
  renderHook((id) => useRecordingActivity({ recordingId: id, status: "ready", messages }), {
    initialProps: recordingId,
  });

beforeEach(() => {
  vi.resetAllMocks();
  bridge.listClicks.mockImplementation(async ({ id }: { id: string }) => [capturedClick(id)]);
  bridge.listTranscript.mockImplementation(async ({ id }: { id: string }) => [
    transcriptSegment(id),
  ]);
  bridge.analyzeClicks.mockImplementation(async ({ id }: { id: string }) => ({
    clicks: [{ ...capturedClick(id), actionDescription: "Menu" }],
    analyzedCount: 1,
    failedCount: 0,
  }));
  bridge.updateTranscript.mockImplementation(
    async ({ recordingId, id, text }: { recordingId: string; id: string; text: string }) => ({
      ...transcriptSegment(recordingId, id),
      text,
    }),
  );
  bridge.updateClick.mockImplementation(
    async ({
      recordingId,
      id,
      description,
    }: {
      recordingId: string;
      id: string;
      description: string;
    }) => ({ ...capturedClick(recordingId, id), actionDescription: description }),
  );
  bridge.deleteTranscript.mockResolvedValue(undefined);
  bridge.deleteClick.mockResolvedValue(undefined);
  bridge.revealScreenshot.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("recording activity lifecycle", () => {
  it.each(["Saved description", null])(
    "loads persisted activities after remounting without reanalyzing descriptions: %s",
    async (actionDescription) => {
      const clicks = [{ ...capturedClick("recording-a"), actionDescription }];

      bridge.listClicks.mockResolvedValue(clicks);
      const first = renderActivity();

      await waitFor(() => expect(first.result.current.isLoading).toBe(false));
      first.unmount();
      const reopened = renderActivity();

      await waitFor(() => expect(reopened.result.current.isLoading).toBe(false));
      expect(reopened.result.current.clicks).toEqual(clicks);
      expect(reopened.result.current.transcript).toEqual([transcriptSegment("recording-a")]);
      expect(reopened.result.current.analyzingClicks).toBe(false);
      expect(bridge.listClicks).toHaveBeenCalledTimes(2);
      expect(bridge.analyzeClicks).not.toHaveBeenCalled();
    },
  );

  it("loads ordered activity and retains selection when unrelated recording metadata changes", async () => {
    const { result, rerender } = renderActivity();

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.selectedActivityKey).toBe("transcript-dialogue-1");

    act(() => result.current.selectActivity("click-click-1"));
    rerender("recording-a");

    expect(result.current.selectedActivityKey).toBe("click-click-1");
    expect(bridge.listClicks).toHaveBeenCalledTimes(1);
  });

  it("ignores old activity loads after changing recordings", async () => {
    const oldClicks = Promise.withResolvers<ClickEvent[]>();

    bridge.listClicks.mockReturnValueOnce(oldClicks.promise);
    const { result, rerender } = renderActivity();

    rerender("recording-b");
    await waitFor(() => expect(result.current.clicks[0]?.recordingId).toBe("recording-b"));
    await act(async () => oldClicks.resolve([capturedClick("recording-a")]));

    expect(result.current.clicks[0].recordingId).toBe("recording-b");
    expect(result.current.transcript[0].recordingId).toBe("recording-b");
    expect(bridge.analyzeClicks).not.toHaveBeenCalled();
  });

  it("does not resurrect a deleted click when analysis finishes later", async () => {
    const analysis = Promise.withResolvers<ClickAnalysisResult>();

    bridge.analyzeClicks.mockReturnValue(analysis.promise);
    const { result } = renderActivity();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => {
      void result.current.retryAnalysis();
    });
    expect(result.current.analyzingClicks).toBe(true);
    await act(async () => {
      await result.current.removeClick(capturedClick("recording-a"));
    });

    expect(result.current.clicks).toEqual([]);

    await act(async () =>
      analysis.resolve({
        clicks: [capturedClick("recording-a")],
        analyzedCount: 1,
        failedCount: 0,
      }),
    );

    expect(result.current.clicks).toEqual([]);
    expect(result.current.analyzingClicks).toBe(false);
  });

  it("serializes edits for the owning recording and keeps every pending row busy", async () => {
    const saved = Promise.withResolvers<TranscriptSegment>();

    bridge.updateTranscript.mockReturnValueOnce(saved.promise);
    const { result } = renderActivity();

    await waitFor(() => expect(result.current.transcript).toHaveLength(1));
    let edit: Promise<"saved" | "failed" | "stale">;
    let removal: Promise<boolean>;

    act(() => {
      edit = result.current.saveTranscript(transcriptSegment("recording-a"), "Updated text");
      removal = result.current.removeClick(capturedClick("recording-a"));
    });
    await waitFor(() => expect(bridge.updateTranscript).toHaveBeenCalled());

    expect(bridge.deleteClick).not.toHaveBeenCalled();
    expect(result.current.pendingIds).toEqual(["dialogue-1", "click-1"]);

    await act(async () => {
      saved.resolve({ ...transcriptSegment("recording-a"), text: "Updated text" });
      await edit;
      await removal;
    });

    expect(bridge.deleteClick).toHaveBeenCalledExactlyOnceWith({
      recordingId: "recording-a",
      id: "click-1",
    });
    expect(result.current.transcript[0].text).toBe("Updated text");
    expect(result.current.pendingIds).toEqual([]);
  });

  it("does not apply an edit response or its UI restoration to a new recording", async () => {
    const saved = Promise.withResolvers<TranscriptSegment>();

    bridge.updateTranscript.mockReturnValueOnce(saved.promise);
    const { result, rerender } = renderActivity();

    await waitFor(() => expect(result.current.transcript).toHaveLength(1));
    let edit: Promise<"saved" | "failed" | "stale">;

    act(() => {
      edit = result.current.saveTranscript(transcriptSegment("recording-a"), "Old edit");
    });
    rerender("recording-b");
    await waitFor(() => expect(result.current.transcript[0]?.recordingId).toBe("recording-b"));
    await act(async () => {
      saved.resolve({ ...transcriptSegment("recording-a"), text: "Old edit" });

      expect(await edit).toBe("stale");
    });

    expect(result.current.transcript[0]).toEqual(transcriptSegment("recording-b"));
    expect(result.current.error).toBeNull();
  });

  it("rejects actions for another recording and suppresses post-unmount updates", async () => {
    const saved = Promise.withResolvers<TranscriptSegment>();

    bridge.updateTranscript.mockReturnValueOnce(saved.promise);
    const { result, unmount } = renderActivity();

    await waitFor(() => expect(result.current.transcript).toHaveLength(1));
    await act(async () => {
      expect(
        await result.current.saveTranscript(transcriptSegment("other-recording"), "Wrong target"),
      ).toBe("stale");
      expect(await result.current.removeClick(capturedClick("other-recording"))).toBe(false);
    });

    expect(bridge.updateTranscript).not.toHaveBeenCalled();
    expect(bridge.deleteClick).not.toHaveBeenCalled();

    let edit: Promise<"saved" | "failed" | "stale">;

    act(() => {
      edit = result.current.saveTranscript(transcriptSegment("recording-a"), "Saved in background");
    });
    unmount();
    await act(async () => {
      saved.resolve({ ...transcriptSegment("recording-a"), text: "Saved in background" });

      expect(await edit).toBe("stale");
    });
  });

  it("saves an edited click description for the owning recording", async () => {
    const { result } = renderActivity();

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let edit: Promise<"saved" | "failed" | "stale">;

    await act(async () => {
      edit = result.current.saveClickDescription(capturedClick("recording-a"), "Open settings");

      expect(await edit).toBe("saved");
    });

    expect(bridge.updateClick).toHaveBeenCalledExactlyOnceWith({
      recordingId: "recording-a",
      id: "click-1",
      description: "Open settings",
    });
    expect(result.current.clicks[0].actionDescription).toBe("Open settings");
    expect(result.current.pendingIds).toEqual([]);

    await act(async () => {
      expect(
        await result.current.saveClickDescription(capturedClick("other-recording"), "Wrong target"),
      ).toBe("stale");
    });

    expect(bridge.updateClick).toHaveBeenCalledTimes(1);
  });

  it("retries click analysis after a failure without duplicating in-flight work", async () => {
    bridge.analyzeClicks.mockRejectedValueOnce(new Error("Analyzer unavailable"));
    const { result } = renderActivity();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(() => result.current.retryAnalysis());
    await waitFor(() => expect(result.current.error).toBe("Analyzer unavailable"));
    await act(() => result.current.retryAnalysis());
    await waitFor(() => expect(result.current.clicks[0]?.actionDescription).toBe("Menu"));

    expect(result.current.error).toBeNull();
    expect(result.current.analyzingClicks).toBe(false);
    expect(bridge.analyzeClicks).toHaveBeenCalledTimes(2);
  });

  it("reports analysis and mutation failures while clearing pending state", async () => {
    bridge.analyzeClicks.mockRejectedValue(new Error("Analyzer unavailable"));
    const { result } = renderActivity();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(() => result.current.retryAnalysis());
    await waitFor(() => expect(result.current.error).toBe("Analyzer unavailable"));

    expect(result.current.analyzingClicks).toBe(false);

    bridge.updateTranscript.mockRejectedValue(new Error("Write failed"));
    await act(async () => {
      expect(
        await result.current.saveTranscript(transcriptSegment("recording-a"), "Updated text"),
      ).toBe("failed");
    });

    expect(result.current.error).toBe("Write failed");
    expect(result.current.pendingIds).toEqual([]);
    expect(result.current.transcript[0].text).toBe("Open the menu.");
  });
});
