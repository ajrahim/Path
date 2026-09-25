// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@path/shared/messages/en.json";
import { parseInstructionFlowState } from "@path/shared";
import { WorkspaceWelcome } from "../src/components/WorkspaceWelcome";
import { createInstructionFlowFixture } from "./InstructionFlowFixture";

const mocks = vi.hoisted(() => ({ desktop: null as unknown }));

vi.mock("../src/lib/Desktop", () => ({ getDesktopApi: () => mocks.desktop }));
let fixture: ReturnType<typeof createInstructionFlowFixture>;

beforeEach(() => {
  window.localStorage.clear();
  fixture = createInstructionFlowFixture({
    ...parseInstructionFlowState(null),
    selectedId: "provide-feedback",
    customFlows: [
      { id: "custom-saved", name: "My format", instructions: "Preserve this", icon: "file-text" },
    ],
  });
  mocks.desktop = { instructionFlows: fixture.api };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
async function setup() {
  const onNewRecording = vi.fn();
  const view = render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <WorkspaceWelcome onNewRecording={onNewRecording} />
    </NextIntlClientProvider>,
  );

  await waitFor(() =>
    expect(
      (view.getByRole("button", { name: /Generate Specs/ }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );

  return { view, onNewRecording };
}

describe("Workspace welcome", () => {
  it.each([
    ["Generate Specs", "spec-document"],
    ["Help Guide", "help-guide"],
    ["Provide Feedback", "provide-feedback"],
  ])("starts %s only after saving its selection and retains custom prompts", async (label, id) => {
    const { view, onNewRecording } = await setup();

    fireEvent.click(view.getByRole("button", { name: new RegExp(label) }));
    await waitFor(() => expect(onNewRecording).toHaveBeenCalledOnce());
    expect(fixture.snapshot().selectedId).toBe(id);
    expect(fixture.snapshot().customFlows[0].instructions).toBe("Preserve this");
  });
  it("opens recording setup from the primary action without changing the chosen prompt", async () => {
    const { view, onNewRecording } = await setup();

    fireEvent.click(view.getByRole("button", { name: "New recording" }));
    expect(onNewRecording).toHaveBeenCalledOnce();
    expect(fixture.api.select).not.toHaveBeenCalled();
    expect(fixture.snapshot().selectedId).toBe("provide-feedback");
  });
  it("stays on welcome when saving the prompt selection fails", async () => {
    const { view, onNewRecording } = await setup();

    vi.mocked(fixture.api.select).mockRejectedValueOnce(new Error("Storage unavailable"));
    fireEvent.click(view.getByRole("button", { name: /Generate Specs/ }));
    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toContain("Storage unavailable"),
    );
    expect(onNewRecording).not.toHaveBeenCalled();
    expect(fixture.snapshot().selectedId).toBe("provide-feedback");
  });
});
