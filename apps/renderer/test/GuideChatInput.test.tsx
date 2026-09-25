// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import messages from "@path/shared/messages/en.json";
import { GuideChatInput } from "../src/components/GuideChatInput";

const readImage = vi.hoisted(() => vi.fn());

vi.mock("../src/lib/GuideContextImage", () => ({ readGuideContextImage: readImage }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete window.desktop;
});

function renderChatInput(updating = false, disabled = false, onSend = vi.fn()) {
  const view = render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <GuideChatInput updating={updating} disabled={disabled} onSend={onSend} />
    </NextIntlClientProvider>,
  );

  const input = view.getByPlaceholderText("Update the content...") as HTMLTextAreaElement;
  const send = view.getByRole("button", {
    name: updating ? "Thinking..." : "Send update",
  }) as HTMLButtonElement;

  return { view, input, send, onSend };
}

describe("GuideChatInput", () => {
  it("replaces model controls with an add context button", () => {
    const { view, send } = renderChatInput();

    expect(view.getByRole("button", { name: "Add context" })).toBeTruthy();
    expect(view.container.querySelector(".guide-chat-model")).toBeNull();
    expect(send.disabled).toBe(true);
  });

  it("sends a trimmed prompt and clears the input", async () => {
    const { input, send, onSend } = renderChatInput();

    fireEvent.change(input, { target: { value: "  Add examples  " } });
    fireEvent.click(send);

    expect(onSend).toHaveBeenCalledWith("Add examples", []);
    await waitFor(() => expect(input.value).toBe(""));
  });

  it("sends on Enter but keeps Shift+Enter for newlines", async () => {
    const { input, onSend } = renderChatInput();

    fireEvent.change(input, { target: { value: "Add examples" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    expect(onSend).toHaveBeenCalledWith("Add examples", []);
    await waitFor(() => expect(input.value).toBe(""));
  });

  it("shows a spinner and disables controls while updating", () => {
    const { view, input } = renderChatInput(true);
    const send = view.getByRole("button", { name: "Thinking..." }) as HTMLButtonElement;
    const audio = view.getByRole("button", {
      name: "Voice input is not supported in this browser",
    }) as HTMLButtonElement;

    expect(send.textContent).toBe("");
    expect(send.querySelector(".guide-chat-spinner")).toBeTruthy();
    expect(input.disabled).toBe(true);
    expect(send.disabled).toBe(true);
    expect(audio.disabled).toBe(true);
  });

  it("disables dictation where speech recognition is unavailable", () => {
    const { view } = renderChatInput();

    expect("SpeechRecognition" in window).toBe(false);
    expect("webkitSpeechRecognition" in window).toBe(false);

    const audio = view.getByRole("button", {
      name: "Voice input is not supported in this browser",
    }) as HTMLButtonElement;

    expect(audio.disabled).toBe(true);
  });
});

it("sends added text as separate context and retains it after a failed update", async () => {
  const onSend = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const { view, input, send } = renderChatInput(false, false, onSend);

  fireEvent.click(view.getByRole("button", { name: "Add context" }));
  fireEvent.click(view.getByRole("button", { name: "Add text" }));
  const contextInput = view.getByRole("textbox", { name: "Text context" });

  expect(document.activeElement).toBe(contextInput);
  fireEvent.change(contextInput, { target: { value: "  Use the Save button.  " } });
  fireEvent.click(view.getByRole("button", { name: "Add" }));
  fireEvent.change(input, { target: { value: "Add details" } });
  fireEvent.click(send);
  await waitFor(() => expect(send.disabled).toBe(false));
  expect(onSend).toHaveBeenCalledWith("Add details", [
    { kind: "text", text: "Use the Save button." },
  ]);
  expect(view.getByRole("button", { name: "Remove Text context" })).toBeTruthy();
  expect(input.value).toBe("Add details");
  fireEvent.click(send);
  await waitFor(() => expect(input.value).toBe(""));
  expect(view.queryByRole("button", { name: "Remove Text context" })).toBeNull();
});

it("attaches normalized images, removes context, and reports invalid files", async () => {
  readImage.mockResolvedValueOnce({
    kind: "image",
    name: "screen.png",
    dataUrl: "data:image/png;base64,YQ==",
  });
  const { view } = renderChatInput();
  const fileInput = view.getByLabelText("Add image");

  fireEvent.change(fileInput, {
    target: { files: [new File(["image"], "screen.png", { type: "image/png" })] },
  });
  const remove = await view.findByRole("button", { name: "Remove screen.png" });

  fireEvent.click(remove);
  expect(view.queryByRole("button", { name: "Remove screen.png" })).toBeNull();
  readImage.mockRejectedValueOnce(new Error("Invalid image"));
  fireEvent.change(fileInput, {
    target: { files: [new File(["bad"], "bad.svg", { type: "image/svg+xml" })] },
  });
  expect((await view.findByRole("alert")).textContent).toContain("PNG, JPEG, or WebP");
});

it("returns focus on Escape and limits context to four items", () => {
  const { view } = renderChatInput();
  const trigger = view.getByRole("button", { name: "Add context" });

  fireEvent.click(trigger);
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(document.activeElement).toBe(trigger);
  expect(view.queryByRole("dialog")).toBeNull();
  for (let i = 0; i < 4; i++) {
    fireEvent.click(trigger);
    fireEvent.click(view.getByRole("button", { name: "Add text" }));
    fireEvent.change(view.getByRole("textbox", { name: "Text context" }), {
      target: { value: `Context ${i}` },
    });
    fireEvent.click(view.getByRole("button", { name: "Add" }));
  }

  expect((trigger as HTMLButtonElement).disabled).toBe(true);
});

it("only enables a folder for CLI mode and sends the chosen folder with the update", async () => {
  const state = {
    revision: 1,
    mode: "cli",
    connected: ["codex"],
    selection: { tool: "codex", model: "a", effort: null },
    tools: [],
  };

  const chooseFolder = vi.fn(async () => "C:/Example/Project");

  window.desktop = {
    cli: { get: async () => state, onChanged: () => () => {}, chooseFolder },
  } as never;
  const { view, input, send, onSend } = renderChatInput();
  const folder = view.getByRole("button", { name: "Context Folder" }) as HTMLButtonElement;

  await waitFor(() => expect(folder.disabled).toBe(false));
  fireEvent.click(folder);
  await view.findByRole("button", { name: "Project" });
  fireEvent.change(input, { target: { value: "Use the codebase" } });
  fireEvent.click(send);
  await waitFor(() =>
    expect(onSend).toHaveBeenCalledWith("Use the codebase", [], "C:/Example/Project"),
  );
  expect(chooseFolder).toHaveBeenCalledOnce();
  fireEvent.click(view.getByRole("button", { name: "Remove context folder" }));
  expect(view.getByRole("button", { name: "Context Folder" })).toBeTruthy();
});

it("keeps the folder control disabled without a selected CLI", () => {
  const { view } = renderChatInput();
  const button = view.getByRole("button", { name: "Context Folder" }) as HTMLButtonElement;

  expect(button.disabled).toBe(true);
  expect(button.parentElement?.title).toBe("Connect a CLI in Settings");
});
