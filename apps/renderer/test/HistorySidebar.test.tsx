// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { Provider } from "react-redux";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi } from "@path/shared";
import messages from "@path/shared/messages/en.json";
import { HistorySidebar } from "../src/components/HistorySidebar";
import { createRendererStore } from "../src/state/RendererStore";

afterEach(cleanup);

describe("HistorySidebar layout and version", () => {
  it("renders a direct New Recording action and Settings with version in footer", async () => {
    const onNewRecording = vi.fn();
    const onOpenSettings = vi.fn();
    const getInfo = vi.fn().mockResolvedValue({
      version: "0.3.0",
      platform: "win32",
      dataDirectory: "/data",
    });

    const recordings = {
      list: vi.fn().mockResolvedValue([]),
    };

    const desktop = {
      app: { getInfo },
      projects: { list: vi.fn().mockResolvedValue([]) },
      recordings,
    } as unknown as DesktopApi;

    window.desktop = desktop;

    const store = createRendererStore({ getDesktopApi: () => desktop });

    const view = render(
      <Provider store={store}>
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <HistorySidebar
            selectedId={null}
            onSelect={vi.fn()}
            onDeleted={vi.fn()}
            onNewRecording={onNewRecording}
            onOpenSettings={onOpenSettings}
          />
        </NextIntlClientProvider>
      </Provider>,
    );

    await act(async () => {});

    // The header has one direct recording action, with no dropdown.
    const header = view.container.querySelector(".history-header")!;

    expect(header).toBeTruthy();
    expect(header.querySelector(".section-label")).toBeNull();

    const newButton = header.querySelector("button.history-new-recording")!;

    expect(newButton).toBeTruthy();
    expect(newButton.textContent).toContain("New Recording");
    expect(newButton.hasAttribute("aria-haspopup")).toBe(false);

    fireEvent.click(newButton);
    expect(onNewRecording).toHaveBeenCalledTimes(1);

    // Footer contains Settings button on left and version on right
    const footer = view.container.querySelector(".history-footer")!;

    expect(footer).toBeTruthy();

    const settingsButton = footer.querySelector("button.history-settings")!;

    expect(settingsButton).toBeTruthy();
    fireEvent.click(settingsButton);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);

    const versionSpan = footer.querySelector(".history-version")!;

    expect(versionSpan).toBeTruthy();
    expect(versionSpan.textContent).toBe("v0.3.0");
  });

  it("handles missing desktop bridge gracefully without rendering version", async () => {
    window.desktop = undefined as unknown as DesktopApi;
    const store = createRendererStore({ getDesktopApi: () => null });

    const view = render(
      <Provider store={store}>
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <HistorySidebar
            selectedId={null}
            onSelect={vi.fn()}
            onDeleted={vi.fn()}
            onNewRecording={vi.fn()}
            onOpenSettings={vi.fn()}
          />
        </NextIntlClientProvider>
      </Provider>,
    );

    await act(async () => {});

    const footer = view.container.querySelector(".history-footer")!;

    expect(footer).toBeTruthy();
    expect(footer.querySelector("button.history-settings")).toBeTruthy();
    expect(footer.querySelector(".history-version")).toBeNull();
  });

  it("renders recording, processing, failed, and ready thumbnail states", async () => {
    const items = [
      {
        id: "rec-1",
        title: "Active recording",
        status: "recording" as const,
        captureMode: "display" as const,
        durationMs: 0,
        thumbnailPath: null,
        startedAt: "2026-09-14T10:00:00Z",
        completedAt: null,
        createdAt: "2026-09-14T10:00:00Z",
        updatedAt: "2026-09-14T10:00:00Z",
        transcriptStatus: "processing" as const,
      },
      {
        id: "rec-2",
        title: "Processing recording",
        status: "processing" as const,
        captureMode: "display" as const,
        durationMs: 5000,
        thumbnailPath: null,
        startedAt: "2026-09-14T09:00:00Z",
        completedAt: null,
        createdAt: "2026-09-14T09:00:00Z",
        updatedAt: "2026-09-14T09:00:00Z",
        transcriptStatus: "processing" as const,
      },
      {
        id: "rec-3",
        title: "Failed recording",
        status: "failed" as const,
        captureMode: "display" as const,
        durationMs: 2000,
        thumbnailPath: null,
        startedAt: "2026-09-14T08:00:00Z",
        completedAt: null,
        createdAt: "2026-09-14T08:00:00Z",
        updatedAt: "2026-09-14T08:00:00Z",
        transcriptStatus: "failed" as const,
      },
      {
        id: "rec-4",
        title: "Ready recording with thumbnail",
        status: "ready" as const,
        captureMode: "display" as const,
        durationMs: 12000,
        thumbnailPath: "/data/rec-4/thumbnail.png",
        startedAt: "2026-09-14T07:00:00Z",
        completedAt: "2026-09-14T07:00:12Z",
        createdAt: "2026-09-14T07:00:00Z",
        updatedAt: "2026-09-14T07:00:12Z",
        transcriptStatus: "ready" as const,
      },
    ];

    const recordings = {
      list: vi.fn().mockResolvedValue(items),
      thumbnailUrl: vi
        .fn()
        .mockResolvedValue("http://127.0.0.1:9999/recordings/rec-4/thumbnail.png"),
    };

    const desktop = {
      app: { getInfo: vi.fn().mockResolvedValue({ version: "0.3.0" }) },
      projects: { list: vi.fn().mockResolvedValue([]) },
      recordings,
    } as unknown as DesktopApi;

    window.desktop = desktop;

    const store = createRendererStore({ getDesktopApi: () => desktop });

    const view = render(
      <Provider store={store}>
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <HistorySidebar
            selectedId={null}
            onSelect={vi.fn()}
            onDeleted={vi.fn()}
            onNewRecording={vi.fn()}
            onOpenSettings={vi.fn()}
          />
        </NextIntlClientProvider>
      </Provider>,
    );

    await act(async () => {});

    // Rec 1: Recording dot
    const rec1 = view.container.querySelector('[data-recording-id="rec-1"]')!;

    expect(rec1.querySelector(".history-thumbnail-recording")).toBeTruthy();
    expect(rec1.querySelector(".history-thumbnail-dot")).toBeTruthy();

    // Rec 2: Processing spinner
    const rec2 = view.container.querySelector('[data-recording-id="rec-2"]')!;

    expect(rec2.querySelector(".history-thumbnail-processing")).toBeTruthy();
    expect(rec2.querySelector(".history-thumbnail-spinner")).toBeTruthy();

    // Rec 3: Failed alert
    const rec3 = view.container.querySelector('[data-recording-id="rec-3"]')!;

    expect(rec3.querySelector(".history-thumbnail-failed")).toBeTruthy();

    // Rec 4: Ready image
    const rec4 = view.container.querySelector('[data-recording-id="rec-4"]')!;
    const image = rec4.querySelector("img.history-thumbnail-image");

    expect(image).toBeTruthy();
    expect(image?.getAttribute("src")).toBe("http://127.0.0.1:9999/recordings/rec-4/thumbnail.png");
  });
});
