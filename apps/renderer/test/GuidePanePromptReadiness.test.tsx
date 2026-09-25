// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GuideContextItem, RecordingSummary } from "@path/shared";
import messages from "@path/shared/messages/en.json";
import { GuidePane } from "../src/components/GuidePane";

const mocks = vi.hoisted(() => ({
  flows: {
    loaded: true,
    isBusy: false,
    error: null,
    selectedFlow: {
      id: "custom-review",
      name: "Review",
      icon: "bug",
      instructions: "Current saved instructions",
    },
    builtInFlows: [],
    customFlows: [],
    selectFlow: vi.fn(),
  },
  guide: {
    markdown: "",
    isDirty: false,
    loading: false,
    saving: false,
    generating: false,
    updating: false,
    exporting: false,
    error: null as string | null,
    canRetryGenerate: false,
    restoring: false,
    notice: null,
    draftStatus: "clean",
    isRecoveredDraft: false,
    savedRevisionNumber: null,
    savedAt: null,
    currentRevisionNumber: null,
    revisions: [],
    hasOlderRevisions: false,
    preview: null,
    markdownInputRef: { current: null },
    saveDocument: vi.fn().mockResolvedValue(true),
    discardChanges: vi.fn().mockResolvedValue(true),
    previewRevision: vi.fn(),
    restoreRevision: vi.fn(),
    loadOlderRevisions: vi.fn(),
    generateGuide: vi.fn().mockResolvedValue(undefined),
    updateGuide: vi.fn().mockResolvedValue(undefined),
    editMarkdown: vi.fn(),
    insertImages: vi.fn(),
    copyMarkdown: vi.fn(),
    exportMarkdown: vi.fn(),
  },
  chat: null as null | {
    disabled: boolean;
    onSend(prompt: string, context: GuideContextItem[]): Promise<boolean>;
  },
}));

vi.mock("../src/hooks/useInstructionFlows", () => ({ useInstructionFlows: () => mocks.flows }));
vi.mock("../src/hooks/useGuideDocument", () => ({ useGuideDocument: () => mocks.guide }));
vi.mock("../src/components/InstructionFlowSelect", () => ({ InstructionFlowSelect: () => null }));
vi.mock("../src/components/InstructionFlowEditor", () => ({ InstructionFlowEditor: () => null }));
vi.mock("../src/components/GuideChatInput", () => ({
  GuideChatInput: (props: {
    disabled: boolean;
    onSend(prompt: string, context: GuideContextItem[]): Promise<boolean>;
  }) => {
    mocks.chat = props;

    return (
      <button disabled={props.disabled} onClick={() => void props.onSend("Add examples", [])}>
        Send update
      </button>
    );
  },
}));

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

function pane() {
  return (
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <GuidePane recording={recording} />
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.flows.loaded = true;
  mocks.flows.isBusy = false;
  mocks.flows.selectedFlow.instructions = "Current saved instructions";
  mocks.guide.markdown = "";
  mocks.guide.error = null;
  mocks.guide.canRetryGenerate = false;
  mocks.chat = null;
});

afterEach(cleanup);

describe("GuidePane prompt readiness", () => {
  it.each([
    { reason: "initial prompts are loading", loaded: false, isBusy: false },
    { reason: "the selected prompt is being saved", loaded: true, isBusy: true },
  ])("blocks generation, retry, and chat while $reason", async ({ loaded, isBusy }) => {
    mocks.flows.loaded = loaded;
    mocks.flows.isBusy = isBusy;
    mocks.guide.error = "Previous generation failed";
    mocks.guide.canRetryGenerate = true;
    const view = render(pane());
    const generate = view.getByRole("button", {
      name: "Generate",
    }) as HTMLButtonElement;

    const retry = view.getByRole("button", { name: "Retry" }) as HTMLButtonElement;
    const send = view.getByRole("button", { name: "Send update" }) as HTMLButtonElement;

    expect(generate.disabled).toBe(true);
    expect(retry.disabled).toBe(true);
    expect(send.disabled).toBe(true);
    fireEvent.click(generate);
    fireEvent.click(retry);
    fireEvent.click(send);
    // A queued chat callback must also respect the parent's current readiness guard.
    await act(async () => {
      await mocks.chat?.onSend("Queued update", []);
    });
    expect(mocks.guide.generateGuide).not.toHaveBeenCalled();
    expect(mocks.guide.updateGuide).not.toHaveBeenCalled();
    expect(view.queryByRole("dialog")).toBeNull();
  });

  it.each([
    { reason: "prompts are loading", loaded: false, isBusy: false },
    { reason: "the selection is pending", loaded: true, isBusy: true },
  ])(
    "holds overwrite confirmation while $reason and uses the final selection once ready",
    ({ loaded, isBusy }) => {
      mocks.guide.markdown = "An existing document";
      const view = render(pane());

      fireEvent.click(view.getByRole("button", { name: "Generate" }));
      expect(view.getByRole("dialog")).toBeTruthy();
      expect(mocks.guide.generateGuide).not.toHaveBeenCalled();
      mocks.flows.loaded = loaded;
      mocks.flows.isBusy = isBusy;
      view.rerender(pane());
      const confirm = view.getByRole("button", { name: "Generate anyway" }) as HTMLButtonElement;

      expect(confirm.disabled).toBe(true);
      fireEvent.click(confirm);
      expect(mocks.guide.generateGuide).not.toHaveBeenCalled();
      expect(view.getByRole("dialog")).toBeTruthy();
      mocks.flows.loaded = true;
      mocks.flows.isBusy = false;
      mocks.flows.selectedFlow.instructions = "Latest synchronized prompt";
      view.rerender(pane());
      expect(
        (view.getByRole("button", { name: "Generate anyway" }) as HTMLButtonElement).disabled,
      ).toBe(false);
      fireEvent.click(view.getByRole("button", { name: "Generate anyway" }));
      expect(mocks.guide.generateGuide).toHaveBeenCalledWith("Latest synchronized prompt");
      expect(view.queryByRole("dialog")).toBeNull();
    },
  );

  it("enables generation, retry, and chat with the current saved instructions", () => {
    mocks.guide.error = "Previous generation failed";
    mocks.guide.canRetryGenerate = true;
    const view = render(pane());

    for (const name of ["Generate", "Retry", "Send update"]) {
      const button = view.getByRole("button", { name }) as HTMLButtonElement;

      expect(button.disabled).toBe(false);
      fireEvent.click(button);
    }

    expect(mocks.guide.generateGuide).toHaveBeenCalledTimes(2);
    expect(mocks.guide.generateGuide).toHaveBeenNthCalledWith(1, "Current saved instructions");
    expect(mocks.guide.generateGuide).toHaveBeenNthCalledWith(2, "Current saved instructions");
    expect(mocks.guide.updateGuide).toHaveBeenCalledWith(
      "Current saved instructions",
      "Add examples",
      [],
      undefined,
    );
  });
});
