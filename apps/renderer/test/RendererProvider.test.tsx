// @vitest-environment jsdom

import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { cleanup, render, screen, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordingRuntimeState } from "@path/shared";
import { RendererProvider } from "../src/components/RendererProvider";
import { useRecording } from "../src/hooks/useRecording";
import { routeHasRecordingControls } from "../src/lib/Routes";

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  onStateChanged: vi.fn(),
  list: vi.fn(),
}));

vi.mock("@/lib/Desktop", () => ({
  getDesktopApi: () => ({ recording: mocks, recordings: { list: mocks.list } }),
}));

const idle: RecordingRuntimeState = {
  status: "idle",
  recordingId: null,
  elapsedMs: 0,
  captureClicks: false,
  error: null,
};

function Runtime({ label }: { label: string }) {
  const { snapshot } = useRecording();

  return <output aria-label={label}>{snapshot.status}</output>;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  mocks.getState.mockResolvedValue(idle);
  mocks.onStateChanged.mockReturnValue(vi.fn());
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("renderer state provider", () => {
  it("renders the same initial state for separate server renders without reading the bridge", () => {
    const first = renderToString(
      <RendererProvider hasRecordingControls={routeHasRecordingControls("/")}>
        <Runtime label="runtime" />
      </RendererProvider>,
    );

    const second = renderToString(
      <RendererProvider hasRecordingControls={routeHasRecordingControls("/")}>
        <Runtime label="runtime" />
      </RendererProvider>,
    );

    expect(first).toBe(second);
    expect(first).toContain("idle");
    expect(mocks.getState).not.toHaveBeenCalled();
    expect(mocks.onStateChanged).not.toHaveBeenCalled();
  });

  it("shares one live bridge between consumers and cleans up StrictMode effects", async () => {
    const removeListener = vi.fn();

    mocks.onStateChanged.mockReturnValue(removeListener);
    const view = render(
      <StrictMode>
        <RendererProvider hasRecordingControls>
          <Runtime label="first" />
          <Runtime label="second" />
        </RendererProvider>
      </StrictMode>,
    );

    await act(async () => {});

    // StrictMode replays setup once; exactly one subscription and poller must survive that replay.
    expect(mocks.onStateChanged).toHaveBeenCalledTimes(2);
    expect(removeListener).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);

    act(() => mocks.onStateChanged.mock.calls[1]![0]({ ...idle, status: "recording" }));

    expect(screen.getByLabelText("first").textContent).toBe("recording");
    expect(screen.getByLabelText("second").textContent).toBe("recording");

    view.unmount();

    expect(removeListener).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps stores isolated between renderer roots", async () => {
    render(
      <>
        <RendererProvider hasRecordingControls>
          <Runtime label="first" />
        </RendererProvider>
        <RendererProvider hasRecordingControls>
          <Runtime label="second" />
        </RendererProvider>
      </>,
    );
    await act(async () => {});
    act(() => mocks.onStateChanged.mock.calls[0]![0]({ ...idle, status: "recording" }));

    expect(screen.getByLabelText("first").textContent).toBe("recording");
    expect(screen.getByLabelText("second").textContent).toBe("idle");
  });

  it("disconnects on Settings navigation and reconnects when returning to recording controls", async () => {
    const removeListener = vi.fn();

    mocks.onStateChanged.mockReturnValue(removeListener);
    const view = render(
      <RendererProvider hasRecordingControls>
        <Runtime label="runtime" />
      </RendererProvider>,
    );

    await act(async () => {});
    const oldListener = mocks.onStateChanged.mock.calls[0]![0];

    view.rerender(
      <RendererProvider hasRecordingControls={routeHasRecordingControls("/SettingsPage")}>
        <Runtime label="runtime" />
      </RendererProvider>,
    );
    act(() => oldListener({ ...idle, status: "recording" }));

    expect(removeListener).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(screen.getByLabelText("runtime").textContent).toBe("idle");

    view.rerender(
      <RendererProvider hasRecordingControls>
        <Runtime label="runtime" />
      </RendererProvider>,
    );
    await act(async () => {});

    expect(mocks.onStateChanged).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
  });

  it.each(["/", "/WorkspacePage", "/RecorderPage", "/RecordingToolbarPage"])(
    "connects native recording state on the initial %s route",
    async (pathname) => {
      render(
        <RendererProvider hasRecordingControls={routeHasRecordingControls(pathname)}>
          <Runtime label="runtime" />
        </RendererProvider>,
      );
      await act(async () => {});

      expect(mocks.getState).toHaveBeenCalledTimes(1);
      expect(mocks.onStateChanged).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(1);
    },
  );

  it.each([
    "/SettingsPage",
    "/CapturePage",
    "/RegionPage",
    "/404",
    "/unknown",
    "/RecorderPage/extra",
  ])("does not connect native recording state on %s", (pathname) => {
    render(
      <RendererProvider hasRecordingControls={routeHasRecordingControls(pathname)}>
        <span>Auxiliary surface</span>
      </RendererProvider>,
    );

    expect(mocks.getState).not.toHaveBeenCalled();
    expect(mocks.onStateChanged).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
