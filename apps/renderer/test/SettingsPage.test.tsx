// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { ThemeProvider } from "next-themes";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DesktopApi, DesktopSettings, InstructionFlowState } from "@path/shared";
import messages from "@path/shared/messages/en.json";
import SettingsPage from "../src/pages/SettingsPage";
import { createInstructionFlowFixture } from "./InstructionFlowFixture";

const bridge = vi.hoisted(() => ({
  get: vi.fn(),
  getAiProviderKeyStatus: vi.fn(),
  getInfo: vi.fn(),
  setTitleBarTheme: vi.fn(),
  instructionFlows: undefined as DesktopApi["instructionFlows"] | undefined,
}));

vi.mock("@/lib/Desktop", () => ({
  getDesktopApi: () => ({
    settings: bridge,
    app: bridge,
    instructionFlows: bridge.instructionFlows,
  }),
}));

const settings: DesktopSettings = {
  general: { minimizeToTray: true },
  timelineImports: { maxFileSizeMb: 10 },
  recordingsDirectory: "/recordings",
  guideInstructions: "Original instructions",
  localVisionModel: "vision",
  aiModelSelections: {
    visual: { source: "local", modelId: "vision", modelName: "Vision" },
    text: { source: "local", modelId: "vision", modelName: "Vision" },
  },
};

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/SettingsPage/");
  document.documentElement.removeAttribute("data-theme");
  vi.stubGlobal("matchMedia", () => ({ matches: false, addListener() {}, removeListener() {} }));
  bridge.get.mockResolvedValue(settings);
  bridge.getAiProviderKeyStatus.mockResolvedValue({
    anthropic: false,
    openai: false,
    google: false,
    openrouter: false,
  });
  bridge.getInfo.mockResolvedValue({ version: "0.3.0" });
  bridge.instructionFlows = createInstructionFlowFixture().api;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderSettings() {
  const view = render(
    <ThemeProvider
      attribute="data-theme"
      storageKey="path.theme"
      defaultTheme="light"
      enableSystem={false}
    >
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <SettingsPage />
      </NextIntlClientProvider>
    </ThemeProvider>,
  );

  await view.findByRole("navigation", { name: "Settings" });

  return view;
}

it("shows one section page at a time and follows sidebar and external hash navigation", async () => {
  const view = await renderSettings();
  const navigation = view.getByRole("navigation", { name: "Settings" });

  expect(view.getByRole("heading", { name: "General" })).toBeTruthy();
  expect(view.queryByRole("heading", { name: "Storage" })).toBeNull();
  expect(view.queryByRole("heading", { name: "API Keys" })).toBeNull();

  fireEvent.click(within(navigation).getByRole("link", { name: "Storage" }));
  await view.findByRole("heading", { name: "Storage" });

  expect(view.queryByRole("heading", { name: "General" })).toBeNull();
  expect(window.location.hash).toBe("#storage");
  expect(
    within(navigation).getByRole("link", { name: "Storage" }).getAttribute("aria-current"),
  ).toBe("page");

  act(() => {
    window.history.replaceState(null, "", "#keys");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });

  expect(view.getByRole("heading", { name: "API Keys" })).toBeTruthy();
  expect(view.queryByRole("heading", { name: "Storage" })).toBeNull();

  act(() => {
    window.history.replaceState(null, "", "#unknown");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });

  expect(view.getByRole("heading", { name: "General" })).toBeTruthy();
});

it("opens a native settings deep link and preserves an API key draft across sections", async () => {
  window.history.replaceState(null, "", "#keys");
  const view = await renderSettings();

  expect(view.getByRole("heading", { name: "API Keys" })).toBeTruthy();
  fireEvent.click(view.getAllByRole("button", { name: "Set key" })[0]);
  fireEvent.change(view.getByLabelText("API key"), { target: { value: "unsaved-key-draft" } });
  fireEvent.click(view.getByRole("link", { name: "General" }));
  await view.findByRole("heading", { name: "General" });
  fireEvent.click(view.getByRole("link", { name: "API Keys" }));
  await view.findByRole("heading", { name: "API Keys" });

  expect((view.getByLabelText("API key") as HTMLInputElement).value).toBe("unsaved-key-draft");
});

it("persists Light/Dark appearance through the existing theme provider and reflects external changes", async () => {
  const view = await renderSettings();

  fireEvent.click(view.getByRole("radio", { name: "Dark" }));
  await waitFor(() => expect(document.documentElement.getAttribute("data-theme")).toBe("dark"));

  expect(window.localStorage.getItem("path.theme")).toBe("dark");
  expect(bridge.setTitleBarTheme).toHaveBeenLastCalledWith({ theme: "dark", dimmed: false });

  act(() => {
    window.localStorage.setItem("path.theme", "light");
    window.dispatchEvent(new StorageEvent("storage", { key: "path.theme", newValue: "light" }));
  });

  await waitFor(() =>
    expect((view.getByRole("radio", { name: "Light" }) as HTMLInputElement).checked).toBe(true),
  );
  expect(document.documentElement.getAttribute("data-theme")).toBe("light");

  view.unmount();
  const restored = await renderSettings();

  await waitFor(() =>
    expect((restored.getByRole("radio", { name: "Light" }) as HTMLInputElement).checked).toBe(true),
  );
});

it.each(["light", "dark"])(
  "dims native caption controls with the %s prompt modal and restores them on close",
  async (theme) => {
    window.localStorage.setItem("path.theme", theme);
    window.history.replaceState(null, "", "/SettingsPage/#prompts");
    const view = await renderSettings();

    fireEvent.click(await view.findByRole("button", { name: /Edit Help Guide/ }));
    await view.findByRole("dialog", { name: "Edit prompt" });
    expect(bridge.setTitleBarTheme).toHaveBeenLastCalledWith({ theme, dimmed: true });

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
    expect(bridge.setTitleBarTheme).toHaveBeenLastCalledWith({ theme, dimmed: false });
  },
);

it("edits default prompt instructions and icons without offering deletion", async () => {
  window.history.replaceState(null, "", "#prompts");
  const fixture = createInstructionFlowFixture();

  bridge.instructionFlows = fixture.api;
  const view = await renderSettings();

  fireEvent.click(await view.findByRole("button", { name: "Edit Help Guide" }));
  const dialog = view.getByRole("dialog", { name: "Edit prompt" });

  expect((within(dialog).getByLabelText("Prompt name") as HTMLInputElement).readOnly).toBe(true);
  expect(within(dialog).queryByRole("button", { name: "Delete instruction flow" })).toBeNull();
  fireEvent.change(within(dialog).getByLabelText("Instructions"), {
    target: { value: "Keep every step clear." },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Prompt icon" }));
  fireEvent.click(within(dialog).getByRole("menuitemradio", { name: "Checklist" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Save Prompt" }));

  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  expect(view.getByRole("button", { name: "Edit Help Guide" }).textContent).toBe("Help GuideEdit");
  expect(view.queryByText("Keep every step clear.")).toBeNull();
  expect(fixture.snapshot().builtInOverrides).toEqual([
    { id: "help-guide", instructions: "Keep every step clear.", icon: "list-checks" },
  ]);
});

it("creates, renames, and deletes a custom prompt without changing the workspace selection", async () => {
  window.history.replaceState(null, "", "#prompts");
  const fixture = createInstructionFlowFixture();

  bridge.instructionFlows = fixture.api;
  const view = await renderSettings();

  fireEvent.click(view.getByRole("button", { name: "New prompt" }));
  let dialog = view.getByRole("dialog", { name: "New prompt" });

  fireEvent.change(within(dialog).getByLabelText("Prompt name"), {
    target: { value: "QA review" },
  });
  fireEvent.change(within(dialog).getByLabelText("Instructions"), {
    target: { value: "List observed issues." },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Prompt icon" }));
  fireEvent.click(within(dialog).getByRole("menuitemradio", { name: "Bug" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Save Prompt" }));

  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  expect(fixture.snapshot().selectedId).toBe("help-guide");
  expect(fixture.snapshot().customFlows[0].icon).toBe("bug");
  fireEvent.click(view.getByRole("button", { name: "Edit QA review" }));
  dialog = view.getByRole("dialog", { name: "Edit prompt" });
  fireEvent.change(within(dialog).getByLabelText("Prompt name"), {
    target: { value: "Issue report" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save Prompt" }));
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  fireEvent.click(view.getByRole("button", { name: "Edit Issue report" }));
  fireEvent.click(view.getByRole("button", { name: "Delete instruction flow" }));

  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  expect(view.queryByRole("button", { name: "Edit Issue report" })).toBeNull();
  expect(fixture.snapshot().customFlows).toEqual([]);
  expect(view.getByRole("button", { name: "Edit Help Guide" })).toBeTruthy();
});

it("supports keyboard icon selection and closes the dropdown before the editor", async () => {
  window.history.replaceState(null, "", "#prompts");
  const view = await renderSettings();

  fireEvent.click(await view.findByRole("button", { name: "Edit Help Guide" }));
  const dialog = view.getByRole("dialog");
  const trigger = within(dialog).getByRole("button", { name: "Prompt icon" });

  expect(within(dialog).queryByRole("menu")).toBeNull();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  expect(document.activeElement).toBe(within(dialog).getByRole("menuitemradio", { name: "Book" }));
  fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
  expect(document.activeElement).toBe(
    within(dialog).getByRole("menuitemradio", { name: "Specification" }),
  );
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(within(dialog).queryByRole("menu")).toBeNull();
  expect(view.getByRole("dialog")).toBe(dialog);
  expect(document.activeElement).toBe(trigger);

  fireEvent.click(trigger);
  fireEvent.click(within(dialog).getByRole("menuitemradio", { name: "Idea" }));
  expect(trigger.querySelector(".lucide-lightbulb")).toBeTruthy();
  expect(within(dialog).queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it("keeps keyboard focus inside the prompt editor while a save is pending and restores its opener", async () => {
  window.history.replaceState(null, "", "#prompts");
  const fixture = createInstructionFlowFixture();
  const pending = Promise.withResolvers<InstructionFlowState>();

  vi.mocked(fixture.api.save).mockReturnValueOnce(pending.promise);
  bridge.instructionFlows = fixture.api;
  const view = await renderSettings();
  const opener = await view.findByRole("button", { name: "Edit Help Guide" });

  opener.focus();
  fireEvent.click(opener);
  const dialog = view.getByRole("dialog", { name: "Edit prompt" });
  const close = within(dialog).getByRole("button", { name: "Close prompt editor" });
  const save = within(dialog).getByRole("button", { name: "Save Prompt" });

  expect(document.activeElement).toBe(within(dialog).getByLabelText("Instructions"));
  save.focus();
  fireEvent.keyDown(save, { key: "Tab" });
  expect(document.activeElement).toBe(close);
  fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(save);

  fireEvent.click(save);
  expect(dialog.getAttribute("aria-busy")).toBe("true");
  expect(document.activeElement).toBe(dialog);

  for (const shiftKey of [false, true]) {
    const tab = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey,
      bubbles: true,
      cancelable: true,
    });

    document.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(dialog);
  }

  view.getByRole("link", { name: "General" }).focus();
  fireEvent.keyDown(document, { key: "Tab" });
  expect(document.activeElement).toBe(dialog);

  await act(async () => {
    pending.reject(new Error("Save unavailable"));
  });

  expect(within(dialog).getByRole("alert").textContent).toBe("Save unavailable");
  fireEvent.keyDown(dialog, { key: "Tab" });
  expect(document.activeElement).toBe(close);
  fireEvent.keyDown(close, { key: "Escape" });
  expect(view.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(opener);
});
