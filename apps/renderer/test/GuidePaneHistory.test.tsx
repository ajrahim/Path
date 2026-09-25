// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordingSummary } from "@path/shared";
import messages from "@path/shared/messages/en.json";
import { GuidePane } from "../src/components/GuidePane";
import { createGuideDocumentStore, type GuideDocumentStore } from "./GuideDocumentStoreFixture";

const mocks = vi.hoisted(() => ({ store: null as unknown as GuideDocumentStore }));

vi.mock("@/lib/Desktop", () => ({
  getDesktopApi: () => ({ guides: mocks.store.guides, app: mocks.store.app }),
}));
vi.mock("../src/hooks/useInstructionFlows", () => ({
  useInstructionFlows: () => ({
    loaded: true,
    isBusy: false,
    error: null,
    selectedFlow: { id: "help-guide", name: "Help Guide", icon: "book-open", instructions: "" },
    builtInFlows: [],
    customFlows: [],
    selectFlow: vi.fn(),
  }),
}));
vi.mock("../src/components/InstructionFlowSelect", () => ({ InstructionFlowSelect: () => null }));
vi.mock("../src/components/InstructionFlowEditor", () => ({ InstructionFlowEditor: () => null }));
vi.mock("../src/components/GuideChatInput", () => ({ GuideChatInput: () => null }));

const recording: RecordingSummary = {
  id: "recording-one",
  title: "Recorded review",
  status: "ready",
  captureMode: "display",
  durationMs: 10_000,
  thumbnailPath: null,
  startedAt: "2026-09-23T10:00:00.000Z",
  completedAt: "2026-09-23T10:00:10.000Z",
  createdAt: "2026-09-23T10:00:00.000Z",
  updatedAt: "2026-09-23T10:00:10.000Z",
  transcriptStatus: "ready",
};

beforeEach(() => {
  mocks.store = createGuideDocumentStore(recording.id);
  // jsdom does not implement scrolling; the picker scrolls its checked option into view.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

function renderPane() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <GuidePane recording={recording} />
    </NextIntlClientProvider>,
  );
}

function editor(): HTMLTextAreaElement {
  return screen.getByRole("textbox", { name: messages.guide.editor });
}

function versionTrigger(): HTMLButtonElement {
  return screen.getByRole("button", { name: new RegExp(`^${messages.guide.versionLabel}:`) });
}

describe("GuidePane history", () => {
  it("shows the version and when it was last saved, and never reports a draft as saved", async () => {
    mocks.store.state.savedRevisionNumber = mocks.store.append("saved", "# Saved").number;
    mocks.store.state.savedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000).toISOString();
    renderPane();

    await waitFor(() => expect(editor().value).toBe("# Saved"));
    expect(versionTrigger().textContent).toBe("Version 1");
    expect(screen.getByRole("status").textContent).toBe("Last saved 2 days ago");

    fireEvent.change(editor(), { target: { value: "# Saved\n\nMore" } });

    expect(screen.getByRole("status").textContent).toBe("Unsaved changes · last saved 2 days ago");
  });

  it("labels a recovered draft instead of the save time", async () => {
    mocks.store.state.savedRevisionNumber = mocks.store.append("saved", "# Saved").number;
    mocks.store.state.savedAt = "2026-09-20T00:00:00.000Z";
    mocks.store.state.draft = "# Saved\n\nUnsaved text";
    renderPane();

    await waitFor(() => expect(editor().value).toBe("# Saved\n\nUnsaved text"));
    expect(screen.getByRole("status").textContent).toBe(messages.guide.draftRecovered);
  });

  it("previews, compares, and restores a stored revision", async () => {
    mocks.store.append("generated", "# Guide\nFirst step");
    mocks.store.state.savedRevisionNumber = mocks.store.append(
      "saved",
      "# Guide\nFirst step\nSecond step",
    ).number;
    mocks.store.state.savedAt = "2026-09-20T00:00:00.000Z";
    renderPane();

    await waitFor(() => expect(versionTrigger().textContent).toBe("Version 2"));
    fireEvent.click(versionTrigger());

    const menu = screen.getByRole("menu", { name: messages.guide.versionLabel });
    const options = within(menu).getAllByRole("menuitemradio");

    expect(options).toHaveLength(2);
    expect(options[0]?.getAttribute("aria-checked")).toBe("true");
    expect(options[0]?.textContent).toMatch(/^Version 2Current · Saved · [^·]+$/);
    expect(options[1]?.textContent).toMatch(/^Version 1Generated · /);

    fireEvent.click(options[1]!);

    await waitFor(() => expect(editor().value).toBe("# Guide\nFirst step"));
    expect(editor().readOnly).toBe(true);
    expect(versionTrigger().textContent).toBe("Version 1");
    expect(screen.getByText("Viewing version 1 (read-only)")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Compare/ }));

    const dialog = screen.getByRole("dialog");

    // The current text adds a line that version 1 did not have.
    expect(within(dialog).getByText("1 line added, 0 lines removed")).toBeTruthy();
    expect(dialog.querySelector(".guide-compare-added")?.textContent).toContain("Second step");

    fireEvent.click(within(dialog).getByRole("button", { name: messages.guide.compareClose }));
    fireEvent.click(screen.getByRole("button", { name: /Restore/ }));

    await waitFor(() => expect(editor().readOnly).toBe(false));
    expect(editor().value).toBe("# Guide\nFirst step");
    expect(mocks.store.state.revisions.at(-1)).toMatchObject({
      kind: "restored",
      restoredFromNumber: 1,
    });
    await waitFor(() => expect(versionTrigger().textContent).toBe("Version 3"));
    expect(screen.getByRole("status").textContent).toMatch(/^Unsaved changes · last saved /);
  });

  it("selects versions from the dropdown and returns to the editable text", async () => {
    mocks.store.append("generated", "# One");
    mocks.store.append("generated", "# Two");
    // A generated result is kept as the unsaved draft until it is saved.
    mocks.store.state.draft = "# Two";
    renderPane();

    await waitFor(() => expect(versionTrigger().textContent).toBe("Version 2"));
    expect(screen.queryByRole("button", { name: "Previous version" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Next version" })).toBeNull();
    fireEvent.click(versionTrigger());
    fireEvent.click(screen.getAllByRole("menuitemradio")[1]!);

    await waitFor(() => expect(editor().value).toBe("# One"));
    expect(editor().readOnly).toBe(true);

    fireEvent.click(versionTrigger());
    fireEvent.click(screen.getAllByRole("menuitemradio")[0]!);

    await waitFor(() => expect(editor().readOnly).toBe(false));
    expect(versionTrigger().textContent).toBe("Version 2");
  });
});
