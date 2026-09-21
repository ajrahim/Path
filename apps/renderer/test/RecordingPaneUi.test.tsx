// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { Provider } from "react-redux";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClickEvent, RecordingSummary, TranscriptSegment } from "@path/shared";
import messages from "@path/shared/messages/en.json";
import { RecordingPane } from "../src/components/RecordingPane";
import { createRendererStore } from "../src/state/RendererStore";
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
  screenshotUrl: vi.fn(),
  mediaUrl: vi.fn(),
  retryProcessing: vi.fn(),
}));

vi.mock("@/lib/Desktop", () => ({ getDesktopApi: () => ({ recordings: bridge }) }));

const aiModels = vi.hoisted(() => ({
  models: { api: [] as string[], local: [] as string[] },
  isLoading: false,
}));

vi.mock("../src/hooks/useAiModels", () => ({ useAiModels: () => aiModels }));

class TestResizeObserver implements ResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();

  constructor(readonly callback: ResizeObserverCallback) {}
}

const createObjectURL = vi.fn<(blob: Blob) => string>();
const revokeObjectURL = vi.fn<(url: string) => void>();
const fetchMedia = vi.fn<typeof fetch>();

const recording: RecordingSummary = {
  id: "rec-1",
  title: "Test Walkthrough",
  status: "ready",
  captureMode: "display",
  durationMs: 30_000,
  thumbnailPath: null,
  startedAt: "2026-09-14T10:00:00Z",
  completedAt: "2026-09-14T10:00:30Z",
  createdAt: "2026-09-14T10:00:00Z",
  updatedAt: "2026-09-14T10:00:30Z",
  transcriptStatus: "ready",
};

const sampleClicks: ClickEvent[] = [
  { ...capturedClick("rec-1", "click-1"), timestampMs: 2_000, actionDescription: "Click Save" },
  { ...capturedClick("rec-1", "click-2"), timestampMs: 5_000, actionDescription: "Click Submit" },
];

const sampleTranscript: TranscriptSegment[] = [
  {
    ...transcriptSegment("rec-1", "speech-1"),
    startMs: 1_000,
    endMs: 3_000,
    text: "Welcome to the guide",
  },
  {
    ...transcriptSegment("rec-1", "speech-2"),
    startMs: 4_000,
    endMs: 6_000,
    text: "Click the submit button",
  },
];

beforeEach(() => {
  vi.resetAllMocks();
  aiModels.models = { api: [], local: [] };
  aiModels.isLoading = false;
  vi.stubGlobal("ResizeObserver", TestResizeObserver);

  bridge.listClicks.mockResolvedValue(sampleClicks);
  bridge.listTranscript.mockResolvedValue(sampleTranscript);
  bridge.analyzeClicks.mockResolvedValue({
    clicks: sampleClicks,
    analyzedCount: 2,
    failedCount: 0,
  });
  bridge.mediaUrl.mockResolvedValue("https://media.test/rec-1");
  bridge.screenshotUrl.mockImplementation(
    async ({ id }: { id: string }) => `blob:screenshot-${id}`,
  );

  fetchMedia.mockImplementation(
    async () => new Response("video", { headers: { "Content-Type": "video/mp4" } }),
  );
  createObjectURL.mockReturnValue("blob:video-rec-1");

  class MediaURL extends URL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = revokeObjectURL;
  }

  vi.stubGlobal("URL", MediaURL);
  vi.stubGlobal("fetch", fetchMedia);

  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    Object.defineProperty(this, "paused", { configurable: true, value: false });
    this.dispatchEvent(new Event("play"));

    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    Object.defineProperty(this, "paused", { configurable: true, value: true });
    this.dispatchEvent(new Event("pause"));
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderRecordingPane(props: Partial<Parameters<typeof RecordingPane>[0]> = {}) {
  const store = createRendererStore();

  return render(
    <Provider store={store}>
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <RecordingPane
          recording={recording}
          onNewRecording={vi.fn()}
          onOpenSettings={vi.fn()}
          {...props}
        />
      </NextIntlClientProvider>
    </Provider>,
  );
}

describe("RecordingPane UI interactions", () => {
  it.each(["local", "api", "loading"] as const)(
    "keeps the empty state minimal when models are %s",
    (state) => {
      if (state === "loading") aiModels.isLoading = true;
      else aiModels.models[state] = ["test-model"];

      const onNewRecording = vi.fn();
      const view = renderRecordingPane({ recording: null, onNewRecording });

      expect(screen.getByText("Create your first walkthrough")).toBeTruthy();
      expect(view.container.querySelector(".video-empty-copy")?.textContent).toBe(
        `${messages.recording.onboardingTitle}${messages.recording.newRecording}`,
      );
      fireEvent.click(screen.getByRole("button", { name: messages.recording.newRecording }));
      expect(onNewRecording).toHaveBeenCalledOnce();
    },
  );

  it("keeps model setup accessible when no models are available", () => {
    const onOpenSettings = vi.fn();

    renderRecordingPane({ recording: null, onOpenSettings });

    expect(screen.getByText(messages.recording.onboardingNeedsModel)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: messages.recording.configureKeys }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it("filters timeline entries between All, Clicks, and Speech", async () => {
    const view = renderRecordingPane();

    await waitFor(() => {
      expect(view.container.querySelectorAll(".activity-entry")).toHaveLength(4);
    });

    const filter = screen.getByRole("combobox", { name: messages.recording.filterActivity });

    expect((filter as HTMLSelectElement).value).toBe("all");

    fireEvent.change(filter, { target: { value: "clicks" } });

    expect(view.container.querySelectorAll(".activity-entry-click")).toHaveLength(2);
    expect(view.container.querySelectorAll(".transcript-entry")).toHaveLength(0);

    fireEvent.change(filter, { target: { value: "speech" } });

    expect(view.container.querySelectorAll(".transcript-entry")).toHaveLength(2);
    expect(view.container.querySelectorAll(".activity-entry-click")).toHaveLength(0);

    const search = screen.getByRole("textbox", { name: messages.recording.searchTranscript });

    fireEvent.change(search, { target: { value: "Welcome" } });
    expect(view.container.querySelectorAll(".activity-entry")).toHaveLength(1);
    fireEvent.change(filter, { target: { value: "clicks" } });
    expect(screen.getByText(messages.recording.noFilteredActivity)).toBeTruthy();
    fireEvent.change(search, { target: { value: "" } });
    fireEvent.change(filter, { target: { value: "all" } });

    expect(view.container.querySelectorAll(".activity-entry")).toHaveLength(4);
  });

  it("seeks from activity times and badges without seeking while editing", async () => {
    const view = renderRecordingPane();

    await waitFor(() => {
      expect(view.container.querySelector("video")).not.toBeNull();
      expect(view.container.querySelectorAll(".activity-entry")).toHaveLength(4);
    });

    const video = view.container.querySelector("video")!;
    const clickRow = view.container.querySelector<HTMLElement>(
      '[data-activity-id="click-click-1"]',
    )!;

    const speechRow = view.container.querySelector<HTMLElement>(
      '[data-activity-id="transcript-speech-1"]',
    )!;

    fireEvent.click(within(clickRow).getByRole("button", { name: "Left click 00:02" }));
    expect(video.currentTime).toBe(2);

    fireEvent.click(
      within(speechRow).getByRole("button", { name: messages.recording.filterSpeech }),
    );
    expect(video.currentTime).toBe(1);

    const clickEditor = within(clickRow).getByRole("textbox", {
      name: messages.recording.editClickDescription,
    });

    fireEvent.focus(clickEditor);
    fireEvent.click(clickEditor);
    fireEvent.keyDown(clickEditor, { key: "ArrowRight" });
    expect(video.currentTime).toBe(1);
    expect(clickEditor.closest("button")).toBeNull();

    const clickBadge = within(clickRow).getByRole("button", { name: messages.recording.leftClick });

    fireEvent.keyDown(clickBadge, { code: "Space" });
    expect(video.paused).toBe(true);
    fireEvent.click(clickBadge);
    expect(video.currentTime).toBe(2);

    const speechEditor = within(speechRow).getByRole("textbox", {
      name: messages.recording.editDialogue,
    });

    fireEvent.click(speechEditor);
    expect(video.currentTime).toBe(2);
    fireEvent.click(speechRow.querySelector(".activity-entry-main")!);
    expect(video.currentTime).toBe(1);
  });

  it("preserves saving inline edits and removing an activity after the row layout changes", async () => {
    const clickDescription = "The user opens the saved document.";
    const dialogue = "Review the saved document before continuing.";

    bridge.updateClick.mockResolvedValue({
      ...sampleClicks[0],
      actionDescription: clickDescription,
    });
    bridge.updateTranscript.mockResolvedValue({ ...sampleTranscript[0], text: dialogue });
    bridge.deleteClick.mockResolvedValue(undefined);

    const view = renderRecordingPane();

    await waitFor(() => {
      expect(view.container.querySelectorAll(".activity-entry")).toHaveLength(4);
    });

    const clickEditor = screen.getAllByRole("textbox", {
      name: messages.recording.editClickDescription,
    })[0];

    Object.defineProperty(clickEditor, "innerText", {
      configurable: true,
      value: clickDescription,
    });
    fireEvent.blur(clickEditor);

    await waitFor(() => {
      expect(bridge.updateClick).toHaveBeenCalledExactlyOnceWith({
        recordingId: recording.id,
        id: sampleClicks[0].id,
        description: clickDescription,
      });
    });

    const speechEditor = screen.getAllByRole("textbox", {
      name: messages.recording.editDialogue,
    })[0];

    Object.defineProperty(speechEditor, "innerText", { configurable: true, value: dialogue });
    fireEvent.blur(speechEditor);

    await waitFor(() => {
      expect(bridge.updateTranscript).toHaveBeenCalledExactlyOnceWith({
        recordingId: recording.id,
        id: sampleTranscript[0].id,
        text: dialogue,
      });
    });

    const clickRow = view.container.querySelector<HTMLElement>(
      '[data-activity-id="click-click-1"]',
    )!;

    fireEvent.click(within(clickRow).getByRole("button", { name: messages.actions.more }));
    const remove = screen.getByRole("menuitem", { name: messages.recording.removeClick });

    expect((remove as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(remove);

    await waitFor(() => {
      expect(bridge.deleteClick).toHaveBeenCalledExactlyOnceWith({
        recordingId: recording.id,
        id: sampleClicks[0].id,
      });
      expect(view.container.querySelectorAll(".activity-entry")).toHaveLength(3);
    });
  });

  it("handles playback keyboard shortcuts with Space, ArrowLeft, and ArrowRight", async () => {
    const view = renderRecordingPane();

    await waitFor(() => {
      expect(view.container.querySelector("video")).not.toBeNull();
    });

    const video = view.container.querySelector("video")!;

    // Space toggles play/pause
    fireEvent.keyDown(window, { code: "Space" });
    expect(video.paused).toBe(false);

    fireEvent.keyDown(window, { code: "Space" });
    expect(video.paused).toBe(true);

    // Arrow keys do not seek when focused in an input
    const input = screen.getByPlaceholderText(messages.recording.searchTranscript);

    input.focus();

    const originalTime = video.currentTime;

    fireEvent.keyDown(input, { key: "ArrowRight" });
    expect(video.currentTime).toBe(originalTime);
  });
});
