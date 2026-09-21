// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@path/shared/messages/en.json";
import { WorkspaceWelcome } from "../src/components/WorkspaceWelcome";
import { FLOW_STORAGE_KEY, loadInstructionFlows } from "../src/lib/InstructionFlows";

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setup() {
  const onNewRecording = vi.fn();
  const view = render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <WorkspaceWelcome onNewRecording={onNewRecording} />
    </NextIntlClientProvider>,
  );

  return { view, onNewRecording };
}

describe("Workspace welcome", () => {
  it.each([
    ["Generate Specs", "spec-document"],
    ["Help Guide", "help-guide"],
    ["Provide Feedback", "provide-feedback"],
  ])("starts %s with the matching prompt and retains custom prompts", (label, id) => {
    const customFlows = [{ id: "custom-saved", name: "My format", instructions: "Preserve this" }];

    window.localStorage.setItem(
      FLOW_STORAGE_KEY,
      JSON.stringify({ selectedId: "custom-saved", customFlows }),
    );
    const { view, onNewRecording } = setup();

    fireEvent.click(view.getByRole("button", { name: new RegExp(label) }));
    expect(onNewRecording).toHaveBeenCalledOnce();
    expect(loadInstructionFlows(window.localStorage.getItem(FLOW_STORAGE_KEY))).toEqual({
      selectedId: id,
      customFlows,
    });
  });

  it("opens recording setup from the primary action without changing the chosen prompt", () => {
    window.localStorage.setItem(
      FLOW_STORAGE_KEY,
      JSON.stringify({ selectedId: "provide-feedback", customFlows: [] }),
    );
    const { view, onNewRecording } = setup();

    fireEvent.click(view.getByRole("button", { name: "New recording" }));
    expect(onNewRecording).toHaveBeenCalledOnce();
    expect(loadInstructionFlows(window.localStorage.getItem(FLOW_STORAGE_KEY)).selectedId).toBe(
      "provide-feedback",
    );
  });

  it("keeps the welcome screen actionable when saving a prompt selection fails", () => {
    const { view, onNewRecording } = setup();

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    fireEvent.click(view.getByRole("button", { name: /Provide Feedback/ }));
    expect(onNewRecording).not.toHaveBeenCalled();
    expect(view.getByRole("alert").textContent).toContain("Storage unavailable");
    expect(loadInstructionFlows(window.localStorage.getItem(FLOW_STORAGE_KEY)).selectedId).toBe(
      "help-guide",
    );
  });
});
