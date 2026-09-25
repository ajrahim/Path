// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { Provider } from "react-redux";
import { afterEach, expect, it, vi } from "vitest";
import type {
  DesktopApi,
  RecordingSummary,
  RecordingTimelineImports,
  TimelineImportFileResult,
} from "@path/shared";
import messages from "@path/shared/messages/en.json";
import WorkspacePage from "../src/pages/WorkspacePage";
import { createRendererStore } from "../src/state/RendererStore";
import type { RecordingPane } from "../src/components/RecordingPane";

const desktopRef = vi.hoisted(() => ({ current: null as DesktopApi | null }));

vi.mock("@/lib/Desktop", () => ({ getDesktopApi: () => desktopRef.current }));
vi.mock("next/router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../src/components/GuidePane", () => ({ GuidePane: () => null }));
vi.mock("../src/components/SourceDialog", () => ({ SourceDialog: () => null }));
vi.mock("../src/components/LocalModelSelect", () => ({ LocalModelSelect: () => null }));

// The page remounts the pane whenever the recording status changes; the stub exposes what survives.
vi.mock("../src/components/RecordingPane", () => ({
  RecordingPane: ({
    recording,
    timelineTab,
    timelineImports,
    onTimelineTabChange,
  }: Parameters<typeof RecordingPane>[0]) => (
    <section data-testid="recording-pane" data-status={recording?.status} data-tab={timelineTab}>
      <button type="button" onClick={() => onTimelineTabChange("log")}>
        Show logs
      </button>
      <button
        type="button"
        disabled={!timelineImports.window}
        onClick={() => void timelineImports.importFile("log")}
      >
        Import log
      </button>
      <span>{timelineImports.imports.log?.fileName ?? "No log"}</span>
    </section>
  ),
}));

afterEach(() => {
  cleanup();
  desktopRef.current = null;
});

const processing: RecordingSummary = {
  id: "4a4c2a0e-9a55-4a4f-8b53-6d1c1f1f0c01",
  title: "Processing walkthrough",
  status: "processing",
  captureMode: "display",
  durationMs: 30_000,
  thumbnailPath: null,
  startedAt: "2026-09-14T10:00:00Z",
  completedAt: null,
  createdAt: "2026-09-14T10:00:00Z",
  updatedAt: "2026-09-14T10:00:30Z",
  transcriptStatus: "processing",
};

const imports: RecordingTimelineImports = {
  window: {
    startedAt: "2026-09-14T10:00:00.000Z",
    endedAt: "2026-09-14T10:00:30.000Z",
  },
  log: null,
  element: null,
};

it("imports a log while the recording processes and keeps it after processing finishes", async () => {
  const importResult = Promise.withResolvers<TimelineImportFileResult>();
  const recordings = {
    list: vi.fn().mockResolvedValue([processing]),
    listTimelineImports: vi.fn().mockResolvedValue(imports),
    importTimelineFile: vi.fn().mockReturnValue(importResult.promise),
    thumbnailUrl: vi.fn().mockResolvedValue(null),
  };

  desktopRef.current = {
    app: {
      consumeRecordingOpened: async () => null,
      onRecordingOpened: () => () => {},
    },
    recordings,
    projects: { list: async () => [] },
  } as unknown as DesktopApi;

  const store = createRendererStore({ getDesktopApi: () => desktopRef.current });
  const view = render(
    <Provider store={store}>
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <WorkspacePage />
      </NextIntlClientProvider>
    </Provider>,
  );

  await act(async () => {});

  const row = view.container.querySelector<HTMLElement>(`[data-recording-id="${processing.id}"]`)!;

  fireEvent.click(within(row).getByRole("button", { name: /Processing walkthrough/ }));
  fireEvent.click(screen.getByRole("button", { name: "Show logs" }));

  const importButton = screen.getByRole<HTMLButtonElement>("button", { name: "Import log" });

  await waitFor(() => expect(importButton.disabled).toBe(false));
  fireEvent.click(importButton);
  expect(recordings.importTimelineFile).toHaveBeenCalledWith({
    recordingId: processing.id,
    kind: "log",
  });

  // Processing finishes while the file dialog is still open; history polling picks it up.
  recordings.list.mockResolvedValue([
    {
      ...processing,
      status: "ready",
      transcriptStatus: "ready",
      completedAt: "2026-09-14T10:01:00Z",
    },
  ]);

  await waitFor(() => expect(screen.getByTestId("recording-pane").dataset.status).toBe("ready"), {
    timeout: 3_000,
  });
  expect(screen.getByTestId("recording-pane").dataset.tab).toBe("log");

  await act(async () => {
    importResult.resolve({
      status: "imported",
      timelineImport: {
        kind: "log",
        fileName: "app.log",
        offsetMs: 0,
        importedAt: "2026-09-14T10:01:05.000Z",
        rowCount: 0,
        entryCount: 0,
        outsideCount: 0,
        unreadableLineCount: 0,
      },
    });
  });

  expect(screen.getByText("app.log")).toBeTruthy();
});
