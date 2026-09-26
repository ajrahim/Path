// @vitest-environment jsdom

import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { Provider } from "react-redux";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi, RecordingProject, RecordingSummary, TimelineImport } from "@path/shared";
import messages from "@path/shared/messages/en.json";
import type { GuidePane } from "../src/components/GuidePane";
import type { RecordingPane } from "../src/components/RecordingPane";
import WorkspacePage from "../src/pages/WorkspacePage";
import { createRendererStore } from "../src/state/RendererStore";

const mocks = vi.hoisted(() => ({
  desktop: null as DesktopApi | null,
  save: vi.fn().mockResolvedValue(true),
  discard: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/Desktop", () => ({ getDesktopApi: () => mocks.desktop }));
vi.mock("next/router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../src/components/SourceDialog", () => ({ SourceDialog: () => null }));
vi.mock("../src/components/LocalModelSelect", () => ({ LocalModelSelect: () => null }));
vi.mock("../src/components/WorkspaceWelcome", () => ({ WorkspaceWelcome: () => null }));
vi.mock("../src/components/OnboardingDialog", () => ({ OnboardingDialog: () => null }));
vi.mock("../src/components/GuidePane", () => ({
  GuidePane: ({ recording, onGuideStateChange }: Parameters<typeof GuidePane>[0]) => (
    <button
      type="button"
      onClick={() =>
        onGuideStateChange?.({ isDirty: true, save: mocks.save, discard: mocks.discard })
      }
    >
      Edit {recording?.title}
    </button>
  ),
}));
vi.mock("../src/components/RecordingPane", () => ({
  RecordingPane: ({ recording, timelineImports }: Parameters<typeof RecordingPane>[0]) => (
    <section data-testid="recording-pane" data-recording={recording?.id}>
      {timelineImports.imports.log?.fileName ?? "No log"}
    </section>
  ),
}));

const first: RecordingSummary = {
  id: "first",
  title: "Existing recording",
  status: "ready",
  captureMode: "display",
  durationMs: 30_000,
  thumbnailPath: null,
  startedAt: "2026-09-25T10:00:00Z",
  completedAt: "2026-09-25T10:00:30Z",
  createdAt: "2026-09-25T10:00:00Z",
  updatedAt: "2026-09-25T10:00:30Z",
  transcriptStatus: "ready",
};

const imported: RecordingSummary = { ...first, id: "imported", title: "Imported walkthrough" };

function createDesktop(pendingId: string | null = null) {
  let pending = pendingId ? { recordingId: pendingId } : null;
  const listeners = new Set<(input: { recordingId: string }) => void>();
  const data = {
    recordings: [first, imported],
    projects: [] as RecordingProject[],
    log: null as TimelineImport | null,
  };

  const app = {
    consumeRecordingOpened: vi.fn(async () => {
      const request = pending;

      pending = null;

      return request;
    }),
    onRecordingOpened: vi.fn((listener: (input: { recordingId: string }) => void) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    }),
  };

  const recordings = {
    list: vi.fn(async () => data.recordings),
    listTimelineImports: vi.fn(async () => ({
      window: { startedAt: first.startedAt, endedAt: first.completedAt! },
      log: data.log,
      element: null,
    })),
    thumbnailUrl: vi.fn().mockResolvedValue(null),
  };

  const projects = { list: vi.fn(async () => data.projects) };

  mocks.desktop = { app, recordings, projects } as unknown as DesktopApi;

  return {
    app,
    recordings,
    projects,
    data,
    listeners,
    open(recordingId: string) {
      pending = { recordingId };
      listeners.forEach((listener) => listener({ recordingId }));
    },
  };
}

function renderWorkspace(strict = false) {
  const store = createRendererStore({ getDesktopApi: () => mocks.desktop });
  const workspace = (
    <Provider store={store}>
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <WorkspacePage />
      </NextIntlClientProvider>
    </Provider>
  );

  return { ...render(strict ? <StrictMode>{workspace}</StrictMode> : workspace), store };
}

beforeEach(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.open = true;
      },
    },
    close: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.open = false;
      },
    },
  });
});

afterEach(() => {
  cleanup();
  mocks.desktop = null;
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("Workspace application links", () => {
  it("keeps manual recording selection working while an older preload awaits restart", async () => {
    const fixture = createDesktop();

    Reflect.deleteProperty(fixture.app, "onRecordingOpened");
    Reflect.deleteProperty(fixture.app, "consumeRecordingOpened");
    const view = renderWorkspace();

    await waitFor(() =>
      expect(view.container.querySelector('[data-recording-id="first"]')).toBeTruthy(),
    );
    const row = view.container.querySelector<HTMLElement>('[data-recording-id="first"]')!;

    fireEvent.click(within(row).getByRole("button", { name: /Existing recording/ }));

    await waitFor(() =>
      expect(screen.getByTestId("recording-pane").dataset.recording).toBe(first.id),
    );
    expect(fixture.listeners.size).toBe(0);
  });

  it("opens a request received before hydration, including React development effect replay", async () => {
    const fixture = createDesktop(imported.id);
    const view = renderWorkspace(true);

    await waitFor(() =>
      expect(screen.getByTestId("recording-pane").dataset.recording).toBe(imported.id),
    );
    expect(fixture.listeners.size).toBe(1);

    view.unmount();

    expect(fixture.listeners.size).toBe(0);
  });

  it("refreshes the library, folders and same-recording imports when a warm request arrives", async () => {
    const fixture = createDesktop(imported.id);
    const { store } = renderWorkspace();

    await waitFor(() =>
      expect(screen.getByTestId("recording-pane").dataset.recording).toBe(imported.id),
    );
    expect(screen.getByText("No log")).toBeTruthy();

    fixture.data.projects = [{ id: "folder", name: "Linked project", recordingIds: [imported.id] }];
    fixture.data.recordings = [first, { ...imported, title: "Processed walkthrough" }];
    fixture.data.log = {
      kind: "log",
      fileName: "linked.log",
      offsetMs: 0,
      importedAt: "2026-09-25T10:01:00Z",
      rowCount: 1,
      entryCount: 1,
      outsideCount: 0,
      unreadableLineCount: 0,
    };

    await act(async () => fixture.open(imported.id));

    await waitFor(() => expect(screen.getByText("linked.log")).toBeTruthy());
    expect(store.getState().projects.projects).toEqual(fixture.data.projects);
    expect(screen.getByRole("textbox", { name: messages.navigation.editTitle }).textContent).toBe(
      "Processed walkthrough",
    );
  });

  it("keeps an unsaved draft selected until the existing save-and-switch guard succeeds", async () => {
    const fixture = createDesktop(first.id);

    renderWorkspace();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Edit Existing recording" })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit Existing recording" }));

    await act(async () => fixture.open(imported.id));

    const dialog = screen.getByRole("dialog", { name: messages.guide.discardTitle });

    expect(screen.getByTestId("recording-pane").dataset.recording).toBe(first.id);
    expect(mocks.discard).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: messages.guide.saveAndSwitch }));

    await waitFor(() =>
      expect(screen.getByTestId("recording-pane").dataset.recording).toBe(imported.id),
    );
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.discard).not.toHaveBeenCalled();
  });
});
