// @vitest-environment jsdom

import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { Provider } from "react-redux";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ApiAiModel,
  ClickEvent,
  ClickAnalysisResult,
  LocalAiModel,
  RecordingSummary,
  TranscriptSegment,
} from "@path/shared";
import messages from "@path/shared/messages/en.json";
import { RecordingPane } from "../src/components/RecordingPane";
import type { TimelineTab } from "../src/components/TimelineTabs";
import { useTimelineImports } from "../src/hooks/useTimelineImports";
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
  listTimelineImports: vi.fn(),
  listTimelineImportRows: vi.fn(),
  locateTimelineImportRow: vi.fn(),
  importTimelineFile: vi.fn(),
  updateTimelineImportOffset: vi.fn(),
  removeTimelineImport: vi.fn(),
}));

vi.mock("@/lib/Desktop", () => ({ getDesktopApi: () => ({ recordings: bridge }) }));

const aiModels = vi.hoisted(() => ({
  models: { api: [] as ApiAiModel[], local: [] as LocalAiModel[] },
  keyStatus: { anthropic: false, openai: true, google: false, openrouter: false },
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
  bridge.listTimelineImports.mockResolvedValue({
    window: {
      startedAt: "2026-09-14T10:00:00.000Z",
      endedAt: "2026-09-14T10:00:30.000Z",
    },
    log: {
      kind: "log",
      fileName: "app.log",
      offsetMs: 0,
      importedAt: "2026-09-14T11:00:00.000Z",
      rowCount: 3,
      entryCount: 2,
      outsideCount: 1,
      unreadableLineCount: 0,
    },
    element: null,
  });
  bridge.listTimelineImportRows.mockResolvedValue({
    start: 0,
    total: 2,
    entries: [
      { id: 1, occurredAt: "2026-09-14T10:00:03.000Z", timestampMs: 3_000, text: "Opened form" },
      { id: 2, occurredAt: "2026-09-14T10:00:07.250Z", timestampMs: 7_250, text: "Saved form" },
    ],
  });
  bridge.locateTimelineImportRow.mockResolvedValue({ index: -1 });
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

type PaneProps = Parameters<typeof RecordingPane>[0];

// Mirrors WorkspacePage, which owns the review tab and imports above the pane's remount boundary.
function PaneWithReviewState(
  props: Omit<PaneProps, "timelineTab" | "timelineImports" | "onTimelineTabChange">,
) {
  const [timelineTab, setTimelineTab] = useState<TimelineTab>("activity");
  const timelineImports = useTimelineImports({
    recordingId: props.recording?.id ?? null,
    durationMs: props.recording?.durationMs ?? null,
  });

  return (
    <RecordingPane
      {...props}
      timelineTab={timelineTab}
      timelineImports={timelineImports}
      onTimelineTabChange={setTimelineTab}
    />
  );
}

function renderRecordingPane(
  props: Partial<Omit<PaneProps, "timelineTab" | "timelineImports" | "onTimelineTabChange">> = {},
) {
  const store = createRendererStore();

  const content = (options: typeof props) => (
    <Provider store={store}>
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <PaneWithReviewState
          recording={recording}
          onNewRecording={vi.fn()}
          onOpenSettings={vi.fn()}
          {...options}
        />
      </NextIntlClientProvider>
    </Provider>
  );

  const view = render(content(props));

  return {
    ...view,
    updateRecording: (next: RecordingSummary) =>
      view.rerender(content({ ...props, recording: next })),
  };
}

describe("RecordingPane UI interactions", () => {
  it("loads saved activities without reporting or restarting processing", async () => {
    const savedClicks = Promise.withResolvers<ClickEvent[]>();

    bridge.listClicks.mockReturnValue(savedClicks.promise);
    renderRecordingPane();

    expect(screen.getByRole("progressbar", { name: "Loading activities..." })).toBeTruthy();
    expect(screen.queryByText("Processing Activities...")).toBeNull();
    expect(screen.queryByRole("list", { name: "Activity" })).toBeNull();

    await act(async () => savedClicks.resolve(sampleClicks));

    expect(screen.getByRole("list", { name: "Activity" })).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(bridge.analyzeClicks).not.toHaveBeenCalled();
  });

  it.each([
    { name: "clicks only", clicks: sampleClicks, transcript: [] },
    { name: "speech only", clicks: [], transcript: sampleTranscript },
    { name: "clicks and speech", clicks: sampleClicks, transcript: sampleTranscript },
  ])("hides partial activity until $name processing completes", async ({ clicks, transcript }) => {
    bridge.listClicks.mockResolvedValue(clicks);
    bridge.listTranscript.mockResolvedValue(transcript);
    const view = renderRecordingPane({
      recording: {
        ...recording,
        status: "processing",
        transcriptStatus: transcript.length ? "processing" : "ready",
      },
    });

    await waitFor(() => expect(bridge.listTranscript).toHaveBeenCalled());
    expect(screen.getByRole("status").textContent).toBe("Processing Activities...");
    expect(screen.getByRole("progressbar", { name: "Processing Activities..." })).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Activity" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Search transcript" })).toBeNull();

    // Completing speech alone must not reveal partial results while click work remains.
    view.updateRecording({ ...recording, status: "processing", transcriptStatus: "ready" });
    expect(screen.queryByRole("list", { name: "Activity" })).toBeNull();
    view.updateRecording(recording);
    expect(screen.getByRole("progressbar", { name: "Loading activities..." })).toBeTruthy();

    expect(await screen.findByRole("list", { name: "Activity" })).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(bridge.analyzeClicks).not.toHaveBeenCalled();
  });

  it("keeps the processing label beside the tabs when reviewing logs", async () => {
    renderRecordingPane({ recording: { ...recording, status: "processing" } });
    fireEvent.click(screen.getByRole("tab", { name: "Logs" }));
    const panel = await screen.findByRole("tabpanel", { name: "Logs" });
    const heading = panel.querySelector(".activity-heading");

    expect(heading?.contains(screen.getByRole("tablist"))).toBe(true);
    expect(heading?.contains(screen.getByRole("status"))).toBe(true);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("shows a completed empty recording without waiting for disabled activity types", async () => {
    bridge.listClicks.mockResolvedValue([]);
    bridge.listTranscript.mockResolvedValue([]);
    renderRecordingPane();

    expect(await screen.findByText(messages.recording.noTimeline)).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(bridge.analyzeClicks).not.toHaveBeenCalled();
  });

  it("ends the spinner and exposes retry after click analysis fails", async () => {
    const clicks = [{ ...sampleClicks[0], actionDescription: null }];

    bridge.listClicks.mockResolvedValue(clicks);
    bridge.analyzeClicks.mockRejectedValue(new Error("Analysis unavailable"));
    renderRecordingPane();

    fireEvent.click(await screen.findByRole("button", { name: "Retry analysis" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Analysis unavailable");
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByRole("list", { name: "Activity" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry analysis" })).toBeTruthy();

    const retry = Promise.withResolvers<ClickAnalysisResult>();

    bridge.analyzeClicks.mockReturnValueOnce(retry.promise);
    fireEvent.click(screen.getByRole("button", { name: "Retry analysis" }));
    expect(screen.getByRole("progressbar", { name: "Processing Activities..." })).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Activity" })).toBeNull();
    await act(async () =>
      retry.resolve({ clicks: sampleClicks, analyzedCount: 1, failedCount: 0 }),
    );
    expect(screen.getByRole("list", { name: "Activity" })).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it.each(["local", "api", "loading"] as const)(
    "keeps the empty state minimal when models are %s",
    (state) => {
      if (state === "loading") {
        aiModels.isLoading = true;
      } else if (state === "local") {
        aiModels.models.local = [
          {
            id: "vision",
            name: "Vision",
            supportedPurposes: ["visual", "text"],
            supportsEffort: false,
            sizeBytes: null,
            modifiedAt: null,
            isLoaded: false,
          },
        ];
      } else {
        aiModels.models.api = [
          {
            id: "vision",
            name: "Vision",
            supportedPurposes: ["visual", "text"],
            supportsEffort: false,
            provider: "openai",
            vendor: null,
            contextLength: null,
            pricing: null,
            isFree: false,
          },
        ];
      }

      const onNewRecording = vi.fn();
      const view = renderRecordingPane({ recording: null, onNewRecording });

      expect(screen.getByText("Create a walkthrough")).toBeTruthy();
      expect(view.container.querySelector(".video-empty-copy")?.textContent).toBe(
        `${messages.recording.onboardingTitle}${messages.recording.newRecording}`,
      );
      fireEvent.click(screen.getByRole("button", { name: messages.recording.newRecording }));
      expect(onNewRecording).toHaveBeenCalledOnce();
    },
  );

  it("keeps visual model setup accessible when only text models are available", () => {
    aiModels.models.local = [
      {
        id: "writer",
        name: "Writer",
        supportedPurposes: ["text"],
        supportsEffort: false,
        sizeBytes: null,
        modifiedAt: null,
        isLoaded: false,
      },
    ];
    renderRecordingPane({ recording: null });

    expect(screen.getByText(messages.recording.onboardingNeedsModel)).toBeTruthy();
  });

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

    const filter = screen.getByRole("button", { name: messages.recording.filterActivity });

    expect(filter.textContent).toContain("All (4)");

    function chooseFilter(label: string) {
      fireEvent.click(filter);
      fireEvent.click(screen.getByRole("menuitemradio", { name: label }));
    }

    chooseFilter("Clicks (2)");

    expect(view.container.querySelectorAll(".activity-entry-click")).toHaveLength(2);
    expect(view.container.querySelectorAll(".transcript-entry")).toHaveLength(0);

    chooseFilter("Speech (2)");

    expect(view.container.querySelectorAll(".transcript-entry")).toHaveLength(2);
    expect(view.container.querySelectorAll(".activity-entry-click")).toHaveLength(0);

    const search = screen.getByRole("textbox", { name: messages.recording.searchTranscript });

    fireEvent.change(search, { target: { value: "Welcome" } });
    expect(view.container.querySelectorAll(".activity-entry")).toHaveLength(1);
    chooseFilter("Clicks (2)");
    expect(screen.getByText(messages.recording.noFilteredActivity)).toBeTruthy();
    fireEvent.change(search, { target: { value: "" } });
    chooseFilter("All (4)");

    expect(view.container.querySelectorAll(".activity-entry")).toHaveLength(4);
  });

  it("switches between review tabs and seeks from imported log rows", async () => {
    const view = renderRecordingPane();

    await waitFor(() => {
      expect(view.container.querySelector("video")).not.toBeNull();
      expect(view.container.querySelectorAll(".activity-entry")).toHaveLength(4);
    });

    const tabs = screen.getByRole("tablist", { name: messages.recording.reviewTabs });
    const activityTab = within(tabs).getByRole("tab", { name: messages.recording.activity });

    expect(activityTab.getAttribute("aria-selected")).toBe("true");

    fireEvent.click(within(tabs).getByRole("tab", { name: messages.recording.logs }));

    expect(view.container.querySelectorAll(".activity-entry")).toHaveLength(0);
    expect(screen.getByText("app.log")).toBeTruthy();
    expect(screen.getByText("1 outside the video")).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: /00:07\.250\s*Saved form/ }));
    expect(view.container.querySelector("video")!.currentTime).toBe(7.25);

    fireEvent.click(screen.getByRole("tab", { name: messages.recording.elements }));
    expect(screen.getByText(messages.recording.elementImportEmpty)).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: messages.recording.activity }));
    expect(view.container.querySelectorAll(".activity-entry")).toHaveLength(4);
    expect(bridge.listTimelineImports).toHaveBeenCalledWith({ id: "rec-1" });
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

  it("keeps the redesigned transport synchronized while seeking, playing, and changing speed", async () => {
    const view = renderRecordingPane();

    await waitFor(() => {
      expect(view.container.querySelector("video")).not.toBeNull();
    });

    const video = view.container.querySelector("video")!;
    const slider = screen.getByRole("slider", { name: messages.recording.title });

    fireEvent.change(slider, { target: { value: "12" } });
    expect(video.currentTime).toBe(12);
    expect(slider.getAttribute("aria-valuetext")).toBe("00:12 / 00:30");

    video.currentTime = 18;
    fireEvent.timeUpdate(video);
    expect((slider as HTMLInputElement).value).toBe("18");
    expect(slider.getAttribute("aria-valuetext")).toBe("00:18 / 00:30");

    fireEvent.click(screen.getByRole("button", { name: "Playback speed: 1×" }));
    expect(video.playbackRate).toBe(1.5);
    expect(screen.getByRole("button", { name: "Playback speed: 1.5×" })).toBeTruthy();

    // jsdom does not implement scrolling the activity row into view during playback.
    for (const entry of view.container.querySelectorAll(".activity-entry")) {
      entry.scrollIntoView = vi.fn();
    }

    fireEvent.click(screen.getByRole("button", { name: messages.recording.play }));
    expect(video.paused).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: messages.recording.pause }));
    expect(video.paused).toBe(true);

    fireEvent.click(
      view.container.querySelector<HTMLButtonElement>(".timeline-click-markers button")!,
    );
    expect(video.currentTime).toBe(sampleClicks[0].timestampMs / 1000);
  });

  it.each([2_424, 6_133])(
    "seeks a marker at %i ms without snapping the scrubber",
    async (timestampMs) => {
      bridge.listClicks.mockResolvedValue([{ ...sampleClicks[0], timestampMs }]);
      const view = renderRecordingPane({ recording: { ...recording, durationMs: 6_133 } });

      await waitFor(() => {
        expect(view.container.querySelector(".timeline-click-markers button")).not.toBeNull();
      });

      fireEvent.click(
        view.container.querySelector<HTMLButtonElement>(".timeline-click-markers button")!,
      );
      const slider = screen.getByRole("slider", {
        name: messages.recording.title,
      }) as HTMLInputElement;

      expect(view.container.querySelector("video")!.currentTime).toBe(timestampMs / 1_000);
      expect(Number(slider.value)).toBe(timestampMs / 1_000);
      expect(slider.validity.stepMismatch).toBe(false);
    },
  );

  it("smoothly follows the media clock between time events and stops sampling when paused", async () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;

    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);

      return nextFrame;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    const view = renderRecordingPane();

    await waitFor(() => expect(view.container.querySelector("video")).not.toBeNull());

    const video = view.container.querySelector("video")!;
    const slider = screen.getByRole("slider", {
      name: messages.recording.title,
    }) as HTMLInputElement;

    function advanceFrame(time: number): void {
      video.currentTime = time;
      const pending = [...frames.values()];

      frames.clear();
      act(() => pending.forEach((callback) => callback(0)));
    }

    // Complete the initial geometry measurement before starting playback.
    advanceFrame(0);
    for (const entry of view.container.querySelectorAll(".activity-entry")) {
      entry.scrollIntoView = vi.fn();
    }

    fireEvent.play(video);
    advanceFrame(0.016);
    expect(Number(slider.value)).toBe(0.016);
    advanceFrame(0.033);
    expect(Number(slider.value)).toBe(0.033);

    // A stalled media clock must not make the seek bar drift forward.
    advanceFrame(0.033);
    expect(Number(slider.value)).toBe(0.033);
    video.currentTime = 0.04;
    fireEvent.timeUpdate(video);
    fireEvent.pause(video);
    expect(Number(slider.value)).toBe(0.04);
    expect(frames.size).toBe(0);

    fireEvent.change(slider, { target: { value: "2.424" } });
    fireEvent.play(video);
    expect(Number(slider.value)).toBe(2.424);
    advanceFrame(2.44);
    expect(Number(slider.value)).toBe(2.44);

    view.unmount();
    expect(frames.size).toBe(0);
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
