// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AiModelSelection,
  AiProviderKeyStatus,
  AvailableAiModels,
  CliState,
  DesktopApi,
} from "@path/shared";
import messages from "@path/shared/messages/en.json";
import { OnboardingDialog } from "../src/components/OnboardingDialog";

const mocks = vi.hoisted(() => ({ desktop: null as unknown }));

vi.mock("../src/lib/Desktop", () => ({ getDesktopApi: () => mocks.desktop }));

const localSelection: AiModelSelection = {
  source: "local",
  modelId: "llama3.2-vision:latest",
  modelName: "llama3.2-vision:latest",
};

const installedModels: AvailableAiModels = {
  api: [],
  local: [
    {
      id: "llama3.2-vision:latest",
      name: "llama3.2-vision:latest",
      sizeBytes: null,
      modifiedAt: null,
      isLoaded: false,
      supportedPurposes: ["visual", "text"],
      supportsEffort: false,
    },
  ],
  ollama: { status: "running", endpoint: "http://127.0.0.1:11434" },
};

const ollamaDown: AvailableAiModels = {
  api: [],
  local: [],
  ollama: { status: "unavailable", endpoint: "http://127.0.0.1:11434" },
};

const noKeys: AiProviderKeyStatus = {
  anthropic: false,
  openai: false,
  google: false,
  openrouter: false,
};

const modelMode: CliState = {
  mode: "model",
  connected: [],
  selection: null,
  revision: 1,
  tools: [],
};

function createDesktop({
  models = ollamaDown,
  keyStatus = noKeys,
  selections = { visual: localSelection, text: localSelection },
}: {
  models?: AvailableAiModels;
  keyStatus?: AiProviderKeyStatus;
  selections?: { visual: AiModelSelection; text: AiModelSelection };
} = {}) {
  const settings = {
    get: vi.fn().mockResolvedValue({
      general: { minimizeToTray: true },
      timelineImports: { maxFileSizeMb: 10 },
      recordingsDirectory: "D:\\Path Recordings",
      aiModelSelections: selections,
    }),
    listAvailableAiModels: vi.fn().mockResolvedValue(models),
    getAiProviderKeyStatus: vi.fn().mockResolvedValue(keyStatus),
    chooseRecordingsDirectory: vi.fn().mockResolvedValue(null),
    updateAiModelSelection: vi.fn(),
  };

  const cli = {
    get: vi.fn().mockResolvedValue(modelMode),
    onChanged: vi.fn(() => () => undefined),
  };

  mocks.desktop = { settings, cli } as unknown as DesktopApi;

  return { settings };
}

function renderDialog() {
  const onClose = vi.fn();
  const onStartRecording = vi.fn();
  const onOpenSettings = vi.fn();

  const view = render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <OnboardingDialog
        onClose={onClose}
        onStartRecording={onStartRecording}
        onOpenSettings={onOpenSettings}
      />
    </NextIntlClientProvider>,
  );

  return { view, onClose, onStartRecording, onOpenSettings };
}

function goToStep(view: ReturnType<typeof render>, title: RegExp): void {
  fireEvent.click(view.getByRole("button", { name: title }));
}

beforeEach(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.open = true;
      },
    },
    close: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.open = false;
      },
    },
  });
  createDesktop();
});

afterEach(() => {
  cleanup();
  mocks.desktop = null;
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  vi.restoreAllMocks();
});

describe("Onboarding dialog", () => {
  it("opens on the welcome step with focus on Next", () => {
    const { view } = renderDialog();

    expect(view.getByRole("dialog", { name: "Getting started with Path" })).toBeTruthy();
    expect(view.getByRole("heading", { name: "Welcome to Path" })).toBeTruthy();
    expect(view.getByText("Step 1 of 5")).toBeTruthy();
    expect(document.activeElement).toBe(view.getByRole("button", { name: "Next" }));
  });

  it("moves between steps with Next, Back, the step dots, and arrow keys", () => {
    const { view } = renderDialog();
    const dialog = view.getByRole("dialog");

    fireEvent.click(view.getByRole("button", { name: "Next" }));
    expect(view.getByRole("heading", { name: "AI that works your way" })).toBeTruthy();
    expect(view.getByText("Step 2 of 5")).toBeTruthy();

    fireEvent.click(view.getByRole("button", { name: "Back" }));
    expect(view.getByRole("heading", { name: "Welcome to Path" })).toBeTruthy();

    goToStep(view, /Go to step 4/);
    expect(view.getByRole("heading", { name: "A clear story from every click" })).toBeTruthy();
    expect(view.getByRole("button", { name: /Go to step 4/ }).getAttribute("aria-current")).toBe(
      "step",
    );

    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(view.getByRole("heading", { name: "Your workflow, ready to share" })).toBeTruthy();

    // The last step does not wrap around.
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(view.getByText("Step 5 of 5")).toBeTruthy();

    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    expect(view.getByRole("heading", { name: "A clear story from every click" })).toBeTruthy();
  });

  it("finishes from Skip and from Escape", () => {
    const { view, onClose } = renderDialog();

    fireEvent.click(view.getByRole("button", { name: "Skip" }));
    expect(onClose).toHaveBeenCalledOnce();

    fireEvent(view.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("replaces Skip with Done in the header and keeps Start first recording in the footer", () => {
    const { view, onClose, onStartRecording } = renderDialog();
    const skip = view.getByRole("button", { name: "Skip" });
    const header = skip.closest("header");

    goToStep(view, /Go to step 5/);

    expect(view.queryByRole("button", { name: "Skip" })).toBeNull();
    expect(view.queryByRole("button", { name: "Next" })).toBeNull();
    expect(view.getByRole("button", { name: "Done" })).toBe(skip);
    expect(view.getByRole("button", { name: "Done" }).closest("header")).toBe(header);
    expect(
      view.getByRole("button", { name: "Start first recording" }).closest("footer"),
    ).toBeTruthy();

    fireEvent.click(view.getByRole("button", { name: "Start first recording" }));
    expect(onStartRecording).toHaveBeenCalledOnce();

    fireEvent.click(view.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps focus in the dialog when Next is replaced on the last step", () => {
    const { view } = renderDialog();
    const next = view.getByRole("button", { name: "Next" });

    for (let step = 0; step < 4; step += 1) {
      next.focus();
      fireEvent.click(view.getByRole("button", { name: "Next" }));
    }

    expect(document.activeElement).toBe(
      view.getByRole("button", { name: "Start first recording" }),
    );
  });

  it("explains that Ollama is unavailable and links to its download page", async () => {
    const { view, onOpenSettings } = renderDialog();

    goToStep(view, /Go to step 2/);

    await waitFor(() =>
      expect(
        view.getAllByText(/Ollama is not running\. Install or start it to use llama3\.2-vision/),
      ).toHaveLength(2),
    );

    const link = view.getByRole("link", { name: /Get Ollama/ });

    expect(link.getAttribute("href")).toBe("https://ollama.com/download");
    expect(link.getAttribute("target")).toBe("_blank");

    fireEvent.click(view.getByRole("button", { name: "Add API key" }));
    expect(onOpenSettings).toHaveBeenCalledWith("keys");
  });

  it("shows the pull command for a missing model and becomes ready after checking again", async () => {
    const { settings } = createDesktop({ models: { ...installedModels, local: [] } });
    const { view } = renderDialog();

    goToStep(view, /Go to step 2/);

    await waitFor(() =>
      expect(view.getAllByText("ollama pull llama3.2-vision:latest")[0].tagName).toBe("CODE"),
    );

    settings.listAvailableAiModels.mockResolvedValue(installedModels);
    fireEvent.click(view.getByRole("button", { name: "Check again" }));

    await waitFor(() => expect(view.getAllByText("Ready")).toHaveLength(2));
    expect(view.queryByText("Needs setup")).toBeNull();
    expect(view.getByRole("link", { name: /Get Ollama/ })).toBeTruthy();
    expect(view.getByRole("button", { name: "Add API key" })).toBeTruthy();
    expect(view.getByText("Your models are ready")).toBeTruthy();

    settings.listAvailableAiModels.mockResolvedValue(ollamaDown);
    fireEvent.click(view.getByRole("button", { name: "Check again" }));

    await waitFor(() => expect(view.getAllByText("Needs setup")).toHaveLength(2));
    expect(view.getByRole("link", { name: /Get Ollama/ })).toBeTruthy();
    expect(view.getByRole("button", { name: "Add API key" })).toBeTruthy();
  });

  it("names the provider whose API key is missing", async () => {
    createDesktop({
      models: installedModels,
      selections: {
        visual: localSelection,
        text: { source: "api", provider: "anthropic", modelId: "claude", modelName: "Claude" },
      },
    });
    const { view } = renderDialog();

    goToStep(view, /Go to step 2/);

    await waitFor(() =>
      expect(view.getByText("Claude needs an API key from Anthropic.")).toBeTruthy(),
    );
    expect(view.getAllByText("Ready")).toHaveLength(1);
    expect(view.getByRole("button", { name: "Add API key" })).toBeTruthy();
  });

  it("keeps the tour and setup guidance usable without the desktop bridge", async () => {
    mocks.desktop = null;
    const { view } = renderDialog();

    goToStep(view, /Go to step 3/);

    expect(view.getByRole("heading", { name: "Show it once. Capture every step." })).toBeTruthy();
    expect(view.getByRole("button", { name: "Next" })).toBeTruthy();

    goToStep(view, /Go to step 2/);
    await waitFor(() => expect(view.getAllByText(/Choose a model below/)).toHaveLength(2));
    expect(view.getByRole("button", { name: "Add API key" })).toBeTruthy();
  });

  it("keeps setup actions and model selection directly available for ready users", async () => {
    const { settings } = createDesktop({ models: installedModels });
    const { view } = renderDialog();

    settings.updateAiModelSelection.mockResolvedValue({
      aiModelSelections: { visual: localSelection, text: localSelection },
    });
    goToStep(view, /Go to step 2/);

    await waitFor(() => expect(view.getAllByText("Ready")).toHaveLength(2));
    expect(view.getByRole("link", { name: /Get Ollama/ })).toBeTruthy();
    expect(view.getByRole("button", { name: "Add API key" })).toBeTruthy();

    fireEvent.click(view.getByRole("button", { name: "Visual" }));
    fireEvent.click(await view.findByRole("menuitemradio", { name: /^llama3.2-vision:latest/ }));

    await waitFor(() =>
      expect(settings.updateAiModelSelection).toHaveBeenCalledWith({
        purpose: "visual",
        selection: localSelection,
      }),
    );
    await waitFor(() => expect(view.getAllByText("Ready")).toHaveLength(2));
    expect(view.getByText("Step 2 of 5")).toBeTruthy();
    expect(view.getByRole("button", { name: "Visual" })).toBeTruthy();
  });

  it("keeps model-search arrows and Escape inside the model picker", async () => {
    createDesktop({ models: installedModels });
    const { view, onClose } = renderDialog();

    goToStep(view, /Go to step 2/);
    await waitFor(() => expect(view.getAllByText("Ready")).toHaveLength(2));
    fireEvent.click(view.getByRole("button", { name: "Visual" }));

    const picker = view.getByRole("dialog", { name: "Visual models" });
    const search = within(picker).getByRole("textbox");

    fireEvent.keyDown(search, { key: "ArrowRight" });
    expect(view.getByText("Step 2 of 5")).toBeTruthy();

    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });

    fireEvent(search, escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(view.queryByRole("dialog", { name: "Visual models" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(view.getByRole("button", { name: "Visual" }));
    fireEvent.blur(
      within(view.getByRole("dialog", { name: "Visual models" })).getByRole("textbox"),
      {
        relatedTarget: view.getByRole("button", { name: "Next" }),
      },
    );
    expect(view.queryByRole("dialog", { name: "Visual models" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("chooses a recordings folder directly and preserves it on cancel or failure", async () => {
    const { settings } = createDesktop();
    const { view } = renderDialog();

    goToStep(view, /Go to step 3/);
    await view.findByText("D:\\Path Recordings");

    settings.chooseRecordingsDirectory.mockResolvedValueOnce({
      recordingsDirectory: "E:\\Walkthroughs",
    });
    fireEvent.click(view.getByRole("button", { name: "Choose folder" }));
    await view.findByText("E:\\Walkthroughs");
    expect(settings.chooseRecordingsDirectory).toHaveBeenCalledOnce();

    fireEvent.click(view.getByRole("button", { name: "Choose folder" }));
    await waitFor(() =>
      expect(
        (view.getByRole("button", { name: "Choose folder" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect(view.getByText("E:\\Walkthroughs")).toBeTruthy();

    settings.chooseRecordingsDirectory.mockRejectedValueOnce(new Error("Folder is unavailable"));
    fireEvent.click(view.getByRole("button", { name: "Choose folder" }));
    expect((await view.findByRole("alert")).textContent).toBe("Folder is unavailable");
    expect(view.getByText("E:\\Walkthroughs")).toBeTruthy();
  });

  it("offers storage settings when a native folder chooser is unavailable", async () => {
    mocks.desktop = null;
    const { view, onOpenSettings } = renderDialog();

    goToStep(view, /Go to step 3/);
    await waitFor(() =>
      expect(
        (view.getByRole("button", { name: "Choose folder" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(view.getByRole("button", { name: "Choose folder" }));

    expect(onOpenSettings).toHaveBeenCalledWith("storage");
  });
});
