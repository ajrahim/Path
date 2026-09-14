// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { Provider } from "react-redux";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi, RecordingSummary } from "@path/shared";
import messages from "@path/shared/messages/en.json";
import WorkspacePage from "../src/pages/WorkspacePage";
import { createRendererStore } from "../src/state/RendererStore";

vi.mock("next/router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../src/components/RecordingPane", () => ({ RecordingPane: () => null }));
vi.mock("../src/components/GuidePane", () => ({ GuidePane: () => null }));
vi.mock("../src/components/SourceDialog", () => ({ SourceDialog: () => null }));
vi.mock("../src/components/LocalModelSelect", () => ({ LocalModelSelect: () => null }));
vi.mock("../src/components/ThemeToggle", () => ({ ThemeToggle: () => null }));

const recording: RecordingSummary = {
  id: "first",
  title: "Original",
  status: "ready",
  captureMode: "display",
  durationMs: 1_000,
  thumbnailPath: null,
  startedAt: "2026-09-14T10:00:00Z",
  completedAt: "2026-09-14T10:00:01Z",
  createdAt: "2026-09-14T10:00:00Z",
  updatedAt: "2026-09-14T10:00:01Z",
  transcriptStatus: "ready",
};

async function renderWorkspace() {
  const recordings = {
    list: vi.fn().mockResolvedValue([recording, { ...recording, id: "second", title: "Another" }]),
    rename: vi.fn(),
  };

  const desktop = { recordings } as unknown as DesktopApi;
  const store = createRendererStore({ getDesktopApi: () => desktop });
  const view = render(
    <Provider store={store}>
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <WorkspacePage />
      </NextIntlClientProvider>
    </Provider>,
  );

  await act(async () => {});
  const firstRow = view.container.querySelector<HTMLElement>('[data-recording-id="first"]')!;
  const secondRow = view.container.querySelector<HTMLElement>('[data-recording-id="second"]')!;

  fireEvent.click(within(firstRow).getByRole("button", { name: /Original/ }));

  return {
    recordings,
    firstRow,
    secondRow,
    header: screen.getByRole("textbox", { name: messages.navigation.editTitle }),
  };
}

function openRenameMenu(row: HTMLElement): HTMLButtonElement {
  fireEvent.click(within(row).getByTitle(messages.actions.more));

  return within(row).getByRole<HTMLButtonElement>("menuitem", { name: messages.actions.rename });
}

afterEach(cleanup);

describe("recording rename editing", () => {
  it("locks header and shared sidebar rename while saving, then preserves the failed draft", async () => {
    const { recordings, header, firstRow } = await renderWorkspace();
    const save = Promise.withResolvers<RecordingSummary>();

    recordings.rename.mockReturnValue(save.promise);
    header.textContent = "Draft title";
    header.innerText = "Draft title";
    fireEvent.blur(header);

    expect(header.getAttribute("contenteditable")).toBe("false");
    expect(openRenameMenu(firstRow).disabled).toBe(true);

    fireEvent.blur(header);

    expect(recordings.rename).toHaveBeenCalledTimes(1);

    await act(async () => save.reject(new Error("Rename failed")));

    expect(header.getAttribute("contenteditable")).toBe("true");
    expect(header.textContent).toBe("Draft title");
    expect(
      within(firstRow).getByRole<HTMLButtonElement>("menuitem", { name: messages.actions.rename })
        .disabled,
    ).toBe(false);
    expect(screen.getByText(messages.navigation.titleSaveFailed)).toBeTruthy();
  });

  it("locks the sidebar draft and other rename controls until failure, then restores editing", async () => {
    const { recordings, header, firstRow, secondRow } = await renderWorkspace();

    fireEvent.click(openRenameMenu(firstRow));
    const input = within(firstRow).getByRole<HTMLInputElement>("textbox");

    fireEvent.change(input, { target: { value: "Sidebar draft" } });
    const save = Promise.withResolvers<RecordingSummary>();

    recordings.rename.mockReturnValue(save.promise);
    fireEvent.blur(input);

    expect(input.disabled).toBe(true);
    expect(header.getAttribute("contenteditable")).toBe("false");
    expect(openRenameMenu(secondRow).disabled).toBe(true);

    await act(async () => save.reject(new Error("Rename failed")));

    expect(input.disabled).toBe(false);
    expect(input.value).toBe("Sidebar draft");
    expect(header.getAttribute("contenteditable")).toBe("true");
    expect(
      within(secondRow).getByRole<HTMLButtonElement>("menuitem", { name: messages.actions.rename })
        .disabled,
    ).toBe(false);
    expect(screen.getByRole("alert").textContent).toBe(messages.navigation.titleSaveFailed);
  });

  it("keeps sidebar editing locked until its post-save history refresh finishes", async () => {
    const { recordings, firstRow } = await renderWorkspace();

    fireEvent.click(openRenameMenu(firstRow));
    const input = within(firstRow).getByRole<HTMLInputElement>("textbox");

    fireEvent.change(input, { target: { value: "Saved title" } });
    const refresh = Promise.withResolvers<RecordingSummary[]>();

    recordings.rename.mockResolvedValue({ ...recording, title: "Saved title" });
    recordings.list.mockReturnValue(refresh.promise);
    fireEvent.blur(input);
    await act(async () => {});

    expect(input.disabled).toBe(true);

    await act(async () => refresh.resolve([{ ...recording, title: "Saved title" }]));

    expect(within(firstRow).queryByRole("textbox")).toBeNull();
    expect(within(firstRow).getByText("Saved title")).toBeTruthy();
  });
});
