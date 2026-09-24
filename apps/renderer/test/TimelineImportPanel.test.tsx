// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecordingTimeWindow, TimelineImport } from "@path/shared";
import messages from "@path/shared/messages/en.json";
import { TimelineImportPanel } from "../src/components/TimelineImportPanel";

afterEach(cleanup);

const timeWindow: RecordingTimeWindow = {
  startedAt: "2026-09-14T10:00:00.000Z",
  endedAt: "2026-09-14T10:00:30.000Z",
  isApproximate: false,
};

const logImport: TimelineImport = {
  kind: "log",
  fileName: "app.log",
  offsetMs: 1_500,
  importedAt: "2026-09-14T11:00:00.000Z",
  entries: [
    { id: 1, occurredAt: "2026-09-14T10:00:01.000Z", timestampMs: 1_000, text: "Opened form" },
    {
      id: 2,
      occurredAt: "2026-09-14T10:00:05.000Z",
      timestampMs: 5_000,
      text: "Error: failed\n    at save (form.ts:10)",
    },
    { id: 3, occurredAt: "2026-09-14T10:00:09.000Z", timestampMs: 9_000, text: "Saved form" },
  ],
  outsideCount: 2,
  unreadableLineCount: 1,
};

function renderPanel(props: Partial<Parameters<typeof TimelineImportPanel>[0]> = {}) {
  const handlers = {
    onImport: vi.fn(),
    onOffsetChange: vi.fn(),
    onRemove: vi.fn(),
    onSeek: vi.fn(),
  };

  const view = render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <TimelineImportPanel
        tabs={<span>Tabs</span>}
        kind="log"
        recordingSelected
        timeWindow={timeWindow}
        timelineImport={logImport}
        isLoading={false}
        isBusy={false}
        error={null}
        currentTimeMs={0}
        playing={false}
        {...handlers}
        {...props}
      />
    </NextIntlClientProvider>,
  );

  return { view, ...handlers };
}

function rowTexts(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".timeline-import-text")].map(
    (row) => row.textContent ?? "",
  );
}

describe("TimelineImportPanel", () => {
  it("shows the video's real-world window, file summary, and aligned rows", () => {
    const { view } = renderPanel();

    expect(view.container.querySelector(".timeline-import-window")?.textContent).toContain(
      "Sep 14, 2026",
    );
    expect(screen.getByText("app.log")).toBeTruthy();
    expect(screen.getByText("3 rows")).toBeTruthy();
    expect(screen.getByText("2 outside the video")).toBeTruthy();
    expect(screen.getByText("1 unreadable line")).toBeTruthy();
    expect(screen.queryByText(messages.recording.approximateTime)).toBeNull();
    expect(rowTexts(view.container)).toEqual(["Opened form", "Error: failed", "Saved form"]);
    expect(screen.getByText("+1")).toBeTruthy();
  });

  it("labels estimated timing as approximate", () => {
    renderPanel({ timeWindow: { ...timeWindow, isApproximate: true } });

    expect(screen.getByText(messages.recording.approximateTime)).toBeTruthy();
  });

  it("seeks and selects a row, and highlights the row at the playhead while playing", () => {
    const { view, onSeek } = renderPanel({ playing: true, currentTimeMs: 6_000 });
    const rows = view.container.querySelectorAll(".timeline-import-row");

    expect(rows[1]?.classList.contains("timeline-import-row-active")).toBe(true);
    expect(rows[0]?.classList.contains("timeline-import-row-active")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /00:09\.000\s*Saved form/ }));

    expect(onSeek).toHaveBeenCalledWith(9_000);
    expect(rows[2]?.classList.contains("selected")).toBe(true);
  });

  it("filters rows by search text", () => {
    const { view } = renderPanel();

    fireEvent.change(screen.getByRole("textbox", { name: messages.recording.searchLogs }), {
      target: { value: "SAVE" },
    });

    expect(rowTexts(view.container)).toEqual(["Error: failed", "Saved form"]);

    fireEvent.change(screen.getByRole("textbox", { name: messages.recording.searchLogs }), {
      target: { value: "missing" },
    });

    expect(screen.getByText(messages.recording.noMatchingRows)).toBeTruthy();
  });

  it("commits a valid offset in seconds and reverts invalid input", () => {
    const { onOffsetChange } = renderPanel();
    const offset = screen.getByRole("spinbutton", { name: messages.recording.importOffsetLabel });

    expect((offset as HTMLInputElement).value).toBe("1.5");

    fireEvent.change(offset, { target: { value: "-2.25" } });
    fireEvent.keyDown(offset, { key: "Enter" });
    fireEvent.blur(offset);

    expect(onOffsetChange).toHaveBeenCalledWith(-2_250);

    fireEvent.change(offset, { target: { value: "90000" } });
    fireEvent.blur(offset);

    expect(onOffsetChange).toHaveBeenCalledTimes(1);
    expect((offset as HTMLInputElement).value).toBe("1.5");
  });

  it("renders element paths as breadcrumb segments", () => {
    const { view } = renderPanel({
      kind: "element",
      timelineImport: {
        ...logImport,
        kind: "element",
        entries: [
          {
            id: 1,
            occurredAt: "2026-09-14T10:00:01.000Z",
            timestampMs: 1_000,
            text: "Header > #div > .menu > #first",
          },
        ],
      },
    });

    const segments = [...view.container.querySelectorAll(".timeline-element-segment code")];

    expect(segments.map((segment) => segment.textContent)).toEqual([
      "Header",
      "#div",
      ".menu",
      "#first",
    ]);
  });

  it("offers import from the empty state and exposes replace and remove actions", () => {
    const empty = renderPanel({ timelineImport: null });

    expect(screen.getByText(messages.recording.logImportEmpty)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: messages.recording.importLogFile }));
    expect(empty.onImport).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: messages.recording.removeLogImport })).toBeNull();

    cleanup();

    const imported = renderPanel();
    const headerImport = screen.getByRole("button", { name: messages.recording.import });

    // The header action is a labeled button beside the tabs, not an icon-only control.
    expect(headerImport.textContent).toBe(messages.recording.import);
    expect(headerImport.closest("header")).toBeTruthy();
    expect(headerImport.getAttribute("title")).toBe(messages.recording.importLogFile);

    fireEvent.click(headerImport);
    expect(imported.onImport).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: messages.recording.removeLogImport }));
    expect(imported.onRemove).toHaveBeenCalledOnce();
  });

  it("explains when rows cannot be shown", () => {
    renderPanel({ timelineImport: { ...logImport, entries: [] } });
    expect(screen.getByText(messages.recording.noRowsInVideo)).toBeTruthy();

    cleanup();
    renderPanel({ timeWindow: null, timelineImport: null });
    expect(screen.getByText(messages.recording.importUnavailable)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: messages.recording.import }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    cleanup();
    renderPanel({ timeWindow: null, timelineImport: null, error: "Rows could not be loaded." });
    expect(screen.getByRole("alert").textContent).toBe("Rows could not be loaded.");
    expect(screen.queryByText(messages.recording.importUnavailable)).toBeNull();
    expect(screen.queryByText(messages.recording.logImportEmpty)).toBeNull();

    cleanup();
    renderPanel({ error: "The file could not be imported." });
    expect(screen.getByRole("alert").textContent).toBe("The file could not be imported.");
  });
});
