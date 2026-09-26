// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { Provider } from "react-redux";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi } from "@path/shared";
import messages from "@path/shared/messages/en.json";
import type { OnboardingDialog } from "../src/components/OnboardingDialog";
import type { SourceDialog } from "../src/components/SourceDialog";
import WorkspacePage from "../src/pages/WorkspacePage";
import { connectionOpened, runtimeReceived } from "../src/state/RecordingSlice";
import { createRendererStore } from "../src/state/RendererStore";

const mocks = vi.hoisted(() => ({ desktop: null as DesktopApi | null }));

vi.mock("@/lib/Desktop", () => ({ getDesktopApi: () => mocks.desktop }));
vi.mock("next/router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../src/components/LocalModelSelect", () => ({ LocalModelSelect: () => null }));
vi.mock("../src/components/WorkspaceWelcome", () => ({ WorkspaceWelcome: () => null }));
vi.mock("../src/components/SourceDialog", () => ({
  SourceDialog: ({ open }: Parameters<typeof SourceDialog>[0]) =>
    open ? <div role="dialog" aria-label="Choose a source" /> : null,
}));
vi.mock("../src/components/OnboardingDialog", () => ({
  OnboardingDialog: ({
    onClose,
    onStartRecording,
    onOpenSettings,
  }: Parameters<typeof OnboardingDialog>[0]) => (
    <div role="dialog" aria-label="Onboarding">
      <button type="button" onClick={onClose}>
        Skip
      </button>
      <button type="button" onClick={onStartRecording}>
        Start first recording
      </button>
      <button type="button" onClick={() => onOpenSettings("keys")}>
        Add API key
      </button>
    </div>
  ),
}));

function createDesktop() {
  const app = {
    openSettings: vi.fn().mockResolvedValue(undefined),
    consumeRecordingOpened: vi.fn().mockResolvedValue(null),
    onRecordingOpened: vi.fn(() => () => undefined),
  };

  mocks.desktop = {
    app,
    recordings: { list: vi.fn().mockResolvedValue([]) },
    projects: { list: vi.fn().mockResolvedValue([]) },
  } as unknown as DesktopApi;

  return { app };
}

function renderWorkspace() {
  const store = createRendererStore({ getDesktopApi: () => mocks.desktop });
  const view = render(
    <Provider store={store}>
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <WorkspacePage />
      </NextIntlClientProvider>
    </Provider>,
  );

  return { view, store };
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  mocks.desktop = null;
  vi.restoreAllMocks();
});

describe("Workspace onboarding", () => {
  it("shows onboarding on first launch and not after it is skipped", async () => {
    createDesktop();
    const first = renderWorkspace();

    await waitFor(() =>
      expect(first.view.getByRole("dialog", { name: "Onboarding" })).toBeTruthy(),
    );

    fireEvent.click(first.view.getByRole("button", { name: "Skip" }));
    expect(first.view.queryByRole("dialog", { name: "Onboarding" })).toBeNull();

    first.view.unmount();

    const second = renderWorkspace();

    expect(second.view.queryByRole("dialog", { name: "Onboarding" })).toBeNull();
  });

  it("finishes onboarding and opens the source dialog from Start first recording", async () => {
    createDesktop();
    const { view } = renderWorkspace();

    fireEvent.click(await view.findByRole("button", { name: "Start first recording" }));

    expect(view.queryByRole("dialog", { name: "Onboarding" })).toBeNull();
    expect(view.getByRole("dialog", { name: "Choose a source" })).toBeTruthy();
    expect(window.localStorage.getItem("path.onboarding")).toBe("complete");
  });

  it("opens the requested Settings section in the desktop app", async () => {
    const { app } = createDesktop();
    const { view } = renderWorkspace();

    fireEvent.click(await view.findByRole("button", { name: "Add API key" }));

    expect(app.openSettings).toHaveBeenCalledWith({ section: "keys" });
  });

  it("stays hidden during an active recording without recording completion", async () => {
    createDesktop();
    const { view, store } = renderWorkspace();

    await view.findByRole("dialog", { name: "Onboarding" });

    act(() => {
      store.dispatch(connectionOpened("connection-1"));
      store.dispatch(
        runtimeReceived({
          connectionId: "connection-1",
          revision: store.getState().recording.revision,
          runtime: {
            status: "recording",
            recordingId: null,
            elapsedMs: 0,
            captureClicks: true,
            error: null,
          },
        }),
      );
    });

    expect(view.queryByRole("dialog", { name: "Onboarding" })).toBeNull();
    expect(window.localStorage.getItem("path.onboarding")).toBeNull();
  });
});
