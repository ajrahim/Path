// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
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

  it("fills an empty library with a start prompt and offers search recovery", async () => {
    const onNewRecording = vi.fn();
    const desktop = {
      app: { getInfo: vi.fn().mockResolvedValue({ version: "0.3.0" }) },
      projects: { list: vi.fn().mockResolvedValue([]) },
      recordings: { list: vi.fn().mockResolvedValue([]) },
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
            onOpenSettings={vi.fn()}
          />
        </NextIntlClientProvider>
      </Provider>,
    );

    await act(async () => {});

    const start = view.container.querySelector(".history-empty-start")!;

    // The empty section fills the list instead of sitting under an "All" heading.
    expect(view.container.querySelector(".history-all-empty")).toBeTruthy();
    expect(view.container.querySelector(".history-all .history-section-label")).toBeNull();
    expect(start.textContent).toContain(messages.history.empty);
    expect(start.textContent).toContain(messages.history.emptyDescription);

    fireEvent.click(within(start as HTMLElement).getByRole("button", { name: /New Recording/ }));
    expect(onNewRecording).toHaveBeenCalledOnce();

    const search = view.getByRole("textbox", { name: messages.history.search });

    fireEvent.change(search, { target: { value: "missing" } });
    await act(async () => {});

    const noMatches = view.container.querySelector(".history-empty-search")!;

    expect(view.container.querySelector(".history-empty-start")).toBeNull();
    expect(noMatches.textContent).toContain(messages.history.noMatches);

    fireEvent.click(
      within(noMatches as HTMLElement).getByRole("button", { name: messages.history.clearSearch }),
    );
    expect((search as HTMLInputElement).value).toBe("");
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

describe("HistorySidebar context menus", () => {
  // Dialog modality varies by jsdom version; these tests assert content, not modality.
  window.HTMLDialogElement.prototype.showModal = function () {};

  window.HTMLDialogElement.prototype.close = function () {};

  const readyRecording = {
    id: "rec-1",
    title: "Demo recording",
    status: "ready" as const,
    captureMode: "display" as const,
    durationMs: 12000,
    thumbnailPath: null,
    startedAt: "2026-09-14T07:00:00Z",
    completedAt: "2026-09-14T07:00:12Z",
    createdAt: "2026-09-14T07:00:00Z",
    updatedAt: "2026-09-14T07:00:12Z",
    transcriptStatus: "ready" as const,
  };

  async function renderSidebar(options: { projects?: unknown[] } = {}) {
    const onSelect = vi.fn();
    const desktop = {
      app: { getInfo: vi.fn().mockResolvedValue({ version: "0.3.0" }) },
      projects: { list: vi.fn().mockResolvedValue(options.projects ?? []) },
      recordings: {
        list: vi.fn().mockResolvedValue([readyRecording]),
        thumbnailUrl: vi.fn().mockResolvedValue(null),
      },
    } as unknown as DesktopApi;

    window.desktop = desktop;

    const store = createRendererStore({ getDesktopApi: () => desktop });
    const view = render(
      <Provider store={store}>
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <HistorySidebar
            selectedId={null}
            onSelect={onSelect}
            onDeleted={vi.fn()}
            onNewRecording={vi.fn()}
            onOpenSettings={vi.fn()}
          />
        </NextIntlClientProvider>
      </Provider>,
    );

    await act(async () => {});

    return { view, onSelect };
  }

  it("renders no 3-dots trigger buttons", async () => {
    const { view } = await renderSidebar({
      projects: [{ id: "p1", name: "Demo", recordingIds: [] }],
    });

    expect(view.container.querySelector(".history-row-menu")).toBeNull();
    expect(view.container.querySelector(".history-item-actions")).toBeNull();

    const menuButtons = Array.from(view.container.querySelectorAll("button")).filter(
      (button) => button.getAttribute("aria-haspopup") === "menu",
    );

    // Only the sort dropdown keeps a menu trigger.
    expect(menuButtons).toHaveLength(1);
  });

  it("opens the recording menu at the cursor and selects the row", async () => {
    const { view, onSelect } = await renderSidebar();
    const row = view.container.querySelector('[data-recording-id="rec-1"]')!;
    const prevented = fireEvent.contextMenu(row, { clientX: 120, clientY: 200 });

    expect(prevented).toBe(false);
    expect(onSelect).toHaveBeenCalledWith("rec-1");

    const menu = view.getByRole("menu", { name: "More actions" });

    expect(menu.style.top).toBe("204px");
    expect(menu.style.left).toBe("112px");
    expect(view.getByRole("menuitem", { name: "Rename" })).toBeTruthy();
    expect(view.getByRole("menuitem", { name: "Move to Project" })).toBeTruthy();
    expect(view.getByRole("menuitem", { name: "Delete" })).toBeTruthy();
  });

  it("starts a rename from the recording menu", async () => {
    const { view } = await renderSidebar();
    const row = view.container.querySelector('[data-recording-id="rec-1"]')!;

    fireEvent.contextMenu(row, { clientX: 120, clientY: 200 });
    fireEvent.click(view.getByRole("menuitem", { name: "Rename" }));

    expect(view.queryByRole("menu")).toBeNull();
    expect(view.container.querySelector(".rename-input")).toBeTruthy();
  });

  it("opens the delete dialog from the recording menu", async () => {
    const { view } = await renderSidebar();
    const row = view.container.querySelector('[data-recording-id="rec-1"]')!;

    fireEvent.contextMenu(row, { clientX: 120, clientY: 200 });
    fireEvent.click(view.getByRole("menuitem", { name: "Delete" }));

    expect(view.getByText("Delete recording?")).toBeTruthy();
  });

  it("opens project actions from the project heading", async () => {
    const { view } = await renderSidebar({
      projects: [{ id: "p1", name: "Demo", recordingIds: [] }],
    });

    const heading = view.getByRole("button", { name: "Demo" });

    fireEvent.contextMenu(heading, { clientX: 120, clientY: 200 });

    expect(view.getByRole("menu", { name: "Project actions: Demo" })).toBeTruthy();
    expect(view.getByRole("menuitem", { name: "Rename" })).toBeTruthy();
    expect(view.getByRole("menuitem", { name: "Remove Project" })).toBeTruthy();

    fireEvent.click(view.getByRole("menuitem", { name: "Remove Project" }));

    expect(
      view.getByText(
        'Remove "Demo"? Its recordings will remain in All. No recordings will be deleted.',
      ),
    ).toBeTruthy();
  });

  it("closes the menu on Escape and returns focus to the row", async () => {
    const { view } = await renderSidebar();
    const row = view.container.querySelector('[data-recording-id="rec-1"]')!;

    fireEvent.contextMenu(row, { clientX: 120, clientY: 200 });

    const menu = view.getByRole("menu", { name: "More actions" });

    fireEvent.keyDown(menu, { key: "Escape" });

    expect(view.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(row.querySelector(".history-item-main"));
  });

  it("anchors keyboard-invoked menus to the row", async () => {
    const { view, onSelect } = await renderSidebar();
    const rowButton = view.container.querySelector(
      '[data-recording-id="rec-1"] .history-item-main',
    )!;

    fireEvent.contextMenu(rowButton);

    expect(onSelect).toHaveBeenCalledWith("rec-1");
    expect(view.getByRole("menu", { name: "More actions" })).toBeTruthy();
  });
});
