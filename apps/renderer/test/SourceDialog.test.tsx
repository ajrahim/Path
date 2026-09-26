// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { Provider } from "react-redux";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureSource, DesktopApi, RecordingRuntimeState } from "@path/shared";
import messages from "@path/shared/messages/en.json";
import { SourceDialog } from "../src/components/SourceDialog";
import { createRendererStore } from "../src/state/RendererStore";

const mocks = vi.hoisted(() => ({ desktop: null as DesktopApi | null }));

vi.mock("@/lib/Desktop", () => ({ getDesktopApi: () => mocks.desktop }));

const idle: RecordingRuntimeState = {
  status: "idle",
  recordingId: null,
  elapsedMs: 0,
  captureClicks: false,
  error: null,
};

const sources: CaptureSource[] = [
  { id: "screen:1", name: "Screen 1", type: "screen", displayId: "1" },
  { id: "screen:2", name: "Screen 2", type: "screen", displayId: "2" },
  { id: "window:1", name: "Notes", type: "window", displayId: null },
].map((source) => ({
  ...source,
  type: source.type as CaptureSource["type"],
  thumbnailDataUrl: "data:image/png;base64,aGVsbG8=",
  displayBounds: null,
  scaleFactor: null,
}));

function renderPicker(availableSources = sources) {
  const recordingApi = {
    listSources: vi.fn().mockResolvedValue(availableSources),
    start: vi.fn().mockResolvedValue({ ...idle, status: "recording", recordingId: "recording-1" }),
    selectRegion: vi.fn(),
  };

  mocks.desktop = { recording: recordingApi } as unknown as DesktopApi;
  const store = createRendererStore({ getDesktopApi: () => mocks.desktop });
  const onClose = vi.fn();
  const onStarted = vi.fn();
  const view = render(
    <Provider store={store}>
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <SourceDialog open onClose={onClose} onStarted={onStarted} />
      </NextIntlClientProvider>
    </Provider>,
  );

  return { ...view, recordingApi, onClose, onStarted };
}

beforeEach(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.setAttribute("open", "");
      },
    },
    close: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.removeAttribute("open");
      },
    },
  });
});

afterEach(() => {
  cleanup();
  mocks.desktop = null;
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});

describe("SourceDialog", () => {
  it("starts the selected screen with the edited name, microphone, and click options", async () => {
    const view = renderPicker();
    const modes = within(view.getByRole("group", { name: messages.recording.steps.mode }));

    expect(modes.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Screen",
      "Window",
      "Area",
    ]);
    fireEvent.click(await view.findByRole("button", { name: "Screen 2" }));
    fireEvent.change(view.getByLabelText("Recording name"), { target: { value: "  Demo  " } });
    fireEvent.click(view.getByRole("button", { name: "Microphone", pressed: true }));
    fireEvent.click(view.getByRole("button", { name: "Capture clicks", pressed: true }));
    expect(view.getByRole("button", { name: "Microphone", pressed: false }).title).toContain(
      messages.recording.microphoneHint,
    );
    expect(view.getByRole("button", { name: "Capture clicks", pressed: false }).title).toContain(
      messages.recording.captureClicksHint,
    );
    fireEvent.click(view.getByRole("button", { name: "Start recording" }));

    await waitFor(() => expect(view.onStarted).toHaveBeenCalledWith("recording-1"));
    expect(view.recordingApi.start).toHaveBeenCalledExactlyOnceWith({
      sourceId: "screen:2",
      title: "Demo",
      captureMode: "display",
      includeMicrophone: false,
      captureClicks: false,
    });
    expect(view.onClose).toHaveBeenCalledOnce();
  });

  it("filters window sources and supplies the default name when the name is blank", async () => {
    const view = renderPicker();

    await view.findByRole("button", { name: "Screen 1" });
    fireEvent.click(view.getByRole("button", { name: "Window" }));
    expect(view.getByRole("button", { name: "Notes", pressed: true })).toBeTruthy();
    expect(view.queryByRole("button", { name: "Screen 1" })).toBeNull();
    const title = view.getByLabelText("Recording name") as HTMLInputElement;
    const defaultTitle = title.value;

    fireEvent.change(title, { target: { value: "   " } });
    fireEvent.click(view.getByRole("button", { name: "Start recording" }));

    await waitFor(() => expect(view.onStarted).toHaveBeenCalled());
    expect(view.recordingApi.start).toHaveBeenCalledWith({
      sourceId: "window:1",
      title: defaultTitle,
      captureMode: "window",
      includeMicrophone: true,
      captureClicks: true,
    });
  });

  it("keeps the picker open when area selection is canceled, then starts the confirmed area", async () => {
    const view = renderPicker();

    view.recordingApi.selectRegion.mockResolvedValueOnce(null);
    fireEvent.click(await view.findByRole("button", { name: "Screen 2" }));
    fireEvent.click(view.getByRole("button", { name: "Area" }));
    expect(view.getByText(messages.recording.regionHint)).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Start recording" }));

    await waitFor(() =>
      expect(view.recordingApi.selectRegion).toHaveBeenCalledWith({
        sourceId: "screen:2",
        displayId: "2",
      }),
    );
    expect(view.recordingApi.start).not.toHaveBeenCalled();
    expect(view.onClose).not.toHaveBeenCalled();

    const region = { displayId: "2", x: 20, y: 30, width: 800, height: 600, scaleFactor: 1 };

    view.recordingApi.selectRegion.mockResolvedValueOnce(region);
    fireEvent.click(view.getByRole("button", { name: "Start recording" }));

    await waitFor(() => expect(view.onStarted).toHaveBeenCalled());
    expect(view.recordingApi.start).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: "screen:2",
        captureMode: "region",
        captureRegion: region,
      }),
    );
  });

  it("disables recording when no source is available", async () => {
    const view = renderPicker([]);

    await view.findByText(messages.recording.noSources);
    expect(
      (view.getByRole("button", { name: "Start recording" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(view.recordingApi.start).not.toHaveBeenCalled();
  });

  it("retains the picker and reports a failed start", async () => {
    const view = renderPicker();

    view.recordingApi.start.mockResolvedValueOnce({
      ...idle,
      status: "failed",
      error: "Capture unavailable",
    });
    await view.findByRole("button", { name: "Screen 1" });
    fireEvent.click(view.getByRole("button", { name: "Start recording" }));

    expect((await view.findByRole("alert")).textContent).toBe("Capture unavailable");
    expect(view.onClose).not.toHaveBeenCalled();
    expect(view.onStarted).not.toHaveBeenCalled();
  });

  it("supports native keyboard dismissal without starting capture", async () => {
    const view = renderPicker();

    await view.findByRole("button", { name: "Screen 1" });
    fireEvent(view.getByRole("dialog"), new Event("cancel", { cancelable: true }));

    expect(view.onClose).toHaveBeenCalledOnce();
    expect(view.recordingApi.start).not.toHaveBeenCalled();
  });
});
