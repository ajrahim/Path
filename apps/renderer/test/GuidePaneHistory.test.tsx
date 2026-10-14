// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GuideDocumentCollection, RecordingSummary } from "@path/shared";
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
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
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
  it("reorders tabs without switching or saving a dirty active document", async () => {
    mocks.store.state.savedRevisionNumber = mocks.store.append("saved", "# Login").number;
    mocks.store.state.savedAt = "2026-09-20T00:00:00.000Z";
    const collection: GuideDocumentCollection = {
      recordingId: recording.id,
      mode: "split",
      planVersion: 1,
      documents: [{ id: "login", title: "Login" }],
      workflows: [
        { id: "login", title: "Login", scope: "Login evidence", documentId: "login" },
        { id: "password", title: "Password", scope: "Password evidence" },
      ],
    };

    vi.mocked(mocks.store.guides.getCollection).mockResolvedValue(collection);
    vi.mocked(mocks.store.guides.saveWorkflowPlan).mockImplementation(async (input) => ({
      ...collection,
      planVersion: 2,
      workflows: input.workflows.map((workflow) => ({
        ...workflow,
        documentId: collection.workflows?.find((candidate) => candidate.id === workflow.id)
          ?.documentId,
      })),
    }));
    renderPane();
    await waitFor(() => expect(editor().value).toBe("# Login"));
    await waitFor(() => expect(editor().disabled).toBe(false));
    vi.mocked(mocks.store.guides.getDocument).mockClear();
    fireEvent.change(editor(), { target: { value: "# Edited Login" } });
    const revisions = [...mocks.store.state.revisions];

    fireEvent.keyDown(screen.getByRole("tab", { name: "Login" }), {
      key: "ArrowRight",
      altKey: true,
      shiftKey: true,
    });
    await waitFor(() =>
      expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
        "Password",
        "Login",
      ]),
    );
    expect(screen.getByRole("tab", { name: "Login" }).getAttribute("aria-selected")).toBe("true");
    expect(editor().value).toBe("# Edited Login");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.store.guides.getDocument).not.toHaveBeenCalled();
    expect(mocks.store.guides.saveDocument).not.toHaveBeenCalled();
    expect(mocks.store.guides.discardDraft).not.toHaveBeenCalled();
    expect(mocks.store.state.revisions).toEqual(revisions);
  });

  it("persists a renamed active split without reloading dirty text or changing history", async () => {
    mocks.store.state.savedRevisionNumber = mocks.store.append("saved", "# Login").number;
    mocks.store.state.savedAt = "2026-09-20T00:00:00.000Z";
    const collection: GuideDocumentCollection = {
      recordingId: recording.id,
      mode: "split",
      planVersion: 1,
      documents: [{ id: "login-document", title: "Login" }],
      workflows: [
        {
          id: "login-document",
          documentId: "login-document",
          title: "Login",
          scope: "Login screen",
        },
      ],
    };

    vi.mocked(mocks.store.guides.getCollection).mockResolvedValue(collection);
    vi.mocked(mocks.store.guides.saveWorkflowPlan).mockImplementation(async (input) => ({
      ...collection,
      planVersion: input.expectedPlanVersion + 1,
      workflows: input.workflows.map((workflow) => ({ ...workflow, documentId: workflow.id })),
    }));
    renderPane();
    await waitFor(() => expect(editor().value).toBe("# Login"));
    const revisions = [...mocks.store.state.revisions];

    vi.mocked(mocks.store.guides.getDocument).mockClear();
    fireEvent.change(editor(), { target: { value: "# Edited Login" } });
    fireEvent.contextMenu(screen.getByRole("tab", { name: "Login" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const dialog = screen.getByRole("dialog", { name: "Rename split" });

    fireEvent.change(within(dialog).getByRole("textbox", { name: "Workflow name" }), {
      target: { value: " Sign in " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Rename" }));
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Sign in" }).getAttribute("aria-selected")).toBe(
        "true",
      ),
    );
    expect(mocks.store.guides.saveWorkflowPlan).toHaveBeenCalledWith({
      id: recording.id,
      expectedPlanVersion: 1,
      workflows: [{ id: "login-document", title: "Sign in", scope: "Login screen" }],
    });
    expect(editor().value).toBe("# Edited Login");
    expect(mocks.store.guides.getDocument).not.toHaveBeenCalled();
    expect(mocks.store.guides.saveDocument).not.toHaveBeenCalled();
    expect(mocks.store.guides.discardDraft).not.toHaveBeenCalled();
    expect(mocks.store.state.revisions).toEqual(revisions);
  });

  it("guards active removals, preserves history, and keeps new and empty plans ungenerated", async () => {
    mocks.store.state.savedRevisionNumber = mocks.store.append("saved", "# Login").number;
    mocks.store.state.savedAt = "2026-09-20T00:00:00.000Z";
    let collection: GuideDocumentCollection = {
      recordingId: recording.id,
      mode: "split",
      planVersion: 1,
      documents: [{ id: "login-document", title: "Login" }],
      workflows: [
        {
          id: "login-document",
          documentId: "login-document",
          title: "Login",
          scope: "Login screen",
        },
      ],
    };

    vi.mocked(mocks.store.guides.getCollection).mockImplementation(async () => collection);
    vi.mocked(mocks.store.guides.saveWorkflowPlan).mockImplementation(async (input) => {
      collection = {
        ...collection,
        workflows: input.workflows,
        planVersion: input.expectedPlanVersion + 1,
      };

      return collection;
    });
    renderPane();
    await waitFor(() => expect(editor().value).toBe("# Login"));
    fireEvent.change(editor(), { target: { value: "# Edited Login" } });
    fireEvent.contextMenu(screen.getByRole("tab", { name: "Login" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Unsaved document changes" })).getByRole("button", {
        name: "Cancel",
      }),
    );
    expect(mocks.store.guides.saveWorkflowPlan).not.toHaveBeenCalled();
    expect(editor().value).toBe("# Edited Login");
    fireEvent.contextMenu(screen.getByRole("tab", { name: "Login" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Unsaved document changes" })).getByRole("button", {
        name: "Save & switch",
      }),
    );
    await waitFor(() => expect(screen.queryAllByRole("tab")).toHaveLength(0));
    await waitFor(() => expect(editor().value).toBe(""));
    expect(editor().disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Generate" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(mocks.store.state.revisions.at(-1)?.markdown).toBe("# Edited Login");
    vi.mocked(mocks.store.guides.getDocument).mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Add split" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Workflow name" }), {
      target: { value: "Profile" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add workflow" }));
    await waitFor(() => expect(screen.getByRole("tab", { name: "Profile" })).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: "Profile" }));
    expect(editor().value).toBe("");
    expect(editor().placeholder).toBe("Not generated");
    expect(mocks.store.guides.getDocument).not.toHaveBeenCalled();
    expect(mocks.store.state.revisions.at(-1)?.markdown).toBe("# Edited Login");
  });

  it("keeps mode changes nondestructive and saves/exports only the selected sheet", async () => {
    const documents = ["Login", "Registration", "Forgot Password"].map((title, index) => ({
      id: `document-${index}`,
      title,
    }));

    const stores = documents.map((document) => {
      const store = createGuideDocumentStore(recording.id);

      store.append("generated", `# ${document.title}`);
      store.state.draft = `# ${document.title}`;

      return store;
    });

    const collection = {
      recordingId: recording.id,
      mode: "split" as const,
      documents,
      workflows: documents.map((document) => ({
        ...document,
        scope: document.title,
        documentId: document.id,
      })),
      planVersion: 1,
    };

    vi.mocked(mocks.store.guides.getCollection).mockResolvedValue(collection);
    vi.mocked(mocks.store.guides.setGenerationMode).mockImplementation(async (input) => ({
      ...collection,
      mode: input.mode,
    }));
    const target = (documentId?: string) =>
      stores[documents.findIndex((document) => document.id === documentId)] ?? stores[0]!;

    vi.mocked(mocks.store.guides.getDocument).mockImplementation((input) =>
      target(input.documentId).guides.getDocument(input),
    );
    vi.mocked(mocks.store.guides.saveDraft).mockImplementation((input) =>
      target(input.documentId).guides.saveDraft(input),
    );
    vi.mocked(mocks.store.guides.saveDocument).mockImplementation((input) =>
      target(input.documentId).guides.saveDocument(input),
    );
    vi.mocked(mocks.store.guides.discardDraft).mockImplementation((input) =>
      target(input.documentId).guides.discardDraft(input),
    );
    vi.mocked(mocks.store.guides.listRevisions).mockImplementation((input) =>
      target(input.documentId).guides.listRevisions(input),
    );
    renderPane();
    await waitFor(() => expect(editor().value).toBe("# Login"));
    fireEvent.click(screen.getByRole("switch", { name: "Split" }));
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Split" }).getAttribute("aria-checked")).toBe(
        "false",
      ),
    );
    expect(editor().value).toBe("# Login");
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.queryByRole("tabpanel")).toBeNull();
    expect(mocks.store.guides.generateCollection).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("switch", { name: "Split" }));
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(3));
    fireEvent.change(editor(), { target: { value: "# Edited Login" } });
    fireEvent.click(screen.getByRole("tab", { name: "Registration" }));
    const dialog = screen.getByRole("dialog", { name: "Unsaved document changes" });

    fireEvent.click(within(dialog).getByRole("button", { name: "Save & switch" }));
    await waitFor(() => expect(editor().value).toBe("# Registration"));
    expect(stores[0]!.state.revisions.at(-1)?.markdown).toBe("# Edited Login");
    expect(stores[1]!.state.draft).toBe("# Registration");
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() =>
      expect(mocks.store.guides.exportMarkdown).toHaveBeenCalledWith({
        suggestedName: "Registration",
        markdown: "# Registration",
      }),
    );
    fireEvent.click(screen.getByRole("switch", { name: "Split" }));
    await waitFor(() => expect(screen.queryAllByRole("tab")).toHaveLength(0));
    expect(editor().value).toBe("# Registration");
    fireEvent.click(screen.getByRole("switch", { name: "Split" }));
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(3));
    expect(editor().value).toBe("# Registration");
    fireEvent.click(screen.getByRole("tab", { name: "Login" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Unsaved document changes" })).getByRole("button", {
        name: "Cancel",
      }),
    );
    expect(editor().value).toBe("# Registration");
    fireEvent.click(screen.getByRole("tab", { name: "Login" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Unsaved document changes" })).getByRole("button", {
        name: "Discard",
      }),
    );
    await waitFor(() => expect(editor().value).toBe("# Edited Login"));
    expect(stores[2]!.state.draft).toBe("# Forgot Password");
  });

  it("shows the version and when it was last saved, and never reports a draft as saved", async () => {
    mocks.store.state.savedRevisionNumber = mocks.store.append("saved", "# Saved").number;
    mocks.store.state.savedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000).toISOString();
    renderPane();

    await waitFor(() => expect(editor().value).toBe("# Saved"));
    await waitFor(() => expect(editor().disabled).toBe(false));
    expect(versionTrigger().textContent).toBe("Version 1");
    expect(screen.getByRole("status").textContent).toBe("Last saved 2 days ago");

    fireEvent.change(editor(), { target: { value: "# Saved\n\nMore" } });

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "Unsaved changes · last saved 2 days ago",
      ),
    );
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
