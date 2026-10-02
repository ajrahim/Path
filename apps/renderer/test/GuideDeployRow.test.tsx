// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import type { CliSelection, CliState } from "@path/shared";
import messages from "@path/shared/messages/en.json";
import { GuideDeployRow } from "../src/components/GuideDeployRow";

afterEach(() => {
  cleanup();
  delete window.desktop;
});

function setup(markdown = "# Current draft", folder: string | null = "C:/Project") {
  const state: CliState = {
    mode: "model",
    connected: ["codex"],
    selection: null,
    revision: 1,
    deployment: { selection: { tool: "codex", model: "a", effort: null }, folder },
    tools: [
      {
        id: "codex",
        connected: true,
        installed: true,
        status: "ready",
        models: [
          { id: "a", name: "Model A", description: "", efforts: ["low", "high"] },
          { id: "b", name: "Model B", description: "", efforts: [] },
        ],
      },
    ],
  };

  const deploy = vi.fn(async (_input: { markdown: string }) => {});
  const selectDeployment = vi.fn(async (selection: CliSelection) => {
    state.deployment.selection = selection;
    state.revision++;

    return structuredClone(state);
  });

  window.desktop = {
    cli: {
      get: async () => structuredClone(state),
      refresh: async () => structuredClone(state),
      onChanged: () => () => {},
      selectDeployment,
      deploy,
    },
  } as never;
  const view = render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <GuideDeployRow markdown={markdown} disabled={false} />
    </NextIntlClientProvider>,
  );

  return { ...view, deploy, selectDeployment, state };
}

it("offers CLI, model, and reasoning without Auto and launches the current draft only on Deploy", async () => {
  const view = setup();

  const button = view.getByRole("button", { name: "Deploy" }) as HTMLButtonElement;

  await waitFor(() => expect(button.disabled).toBe(false));
  expect(view.queryByRole("switch")).toBeNull();
  expect(view.queryByRole("button", { name: "Deploy to CLI" })).toBeNull();
  expect(view.getByRole("group", { name: "Deployment options" })).toBeTruthy();
  expect(view.deploy).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: "Reasoning: Reasoning" }));
  fireEvent.click(view.getByRole("menuitemradio", { name: "high" }));
  await waitFor(() =>
    expect(view.selectDeployment).toHaveBeenCalledWith({
      tool: "codex",
      model: "a",
      effort: "high",
    }),
  );
  await waitFor(() => expect(button.disabled).toBe(false));
  expect(view.state.mode).toBe("model");
  expect(view.deploy).not.toHaveBeenCalled();
  fireEvent.click(button);
  expect(await view.findByRole("status")).toBeTruthy();
  expect(view.deploy).toHaveBeenCalledExactlyOnceWith({ markdown: "# Current draft" });
});

it.each([
  ["", "C:/Project"],
  ["# Draft", null],
])("requires document content and a project folder", async (markdown, folder) => {
  const view = setup(markdown!, folder);

  await waitFor(() => expect(view.getByRole("button", { name: "CLI: Codex CLI" })).toBeTruthy());
  expect((view.getByRole("button", { name: "Deploy" }) as HTMLButtonElement).disabled).toBe(true);
  expect(view.deploy).not.toHaveBeenCalled();
});

it("resets reasoning when changing to a model without reasoning options", async () => {
  const view = setup();

  await waitFor(() =>
    expect(
      (view.getByRole("button", { name: "Model: Model A" }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  fireEvent.click(view.getByRole("button", { name: "Model: Model A" }));
  fireEvent.click(view.getByRole("menuitemradio", { name: "Model B" }));
  await waitFor(() =>
    expect(view.selectDeployment).toHaveBeenCalledWith({ tool: "codex", model: "b", effort: null }),
  );
  expect(
    (view.getByRole("button", { name: "Reasoning: Reasoning" }) as HTMLButtonElement).disabled,
  ).toBe(true);
});

it("reports launch failure without reporting completion or retrying automatically", async () => {
  const view = setup();

  const button = view.getByRole("button", { name: "Deploy" }) as HTMLButtonElement;

  view.deploy.mockRejectedValue(new Error("Terminal unavailable"));
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
  expect((await view.findByRole("alert")).textContent).toBe("Terminal unavailable");
  expect(view.queryByText("Opened in terminal.")).toBeNull();
  expect(view.deploy).toHaveBeenCalledTimes(1);
});

it("supports keyboard menu navigation, selection, and Escape focus restoration", async () => {
  const view = setup();

  const trigger = await view.findByRole("button", { name: "Model: Model A" });

  await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false));
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const first = view.getByRole("menuitemradio", { name: "Model A" });
  const second = view.getByRole("menuitemradio", { name: "Model B" });

  expect(document.activeElement).toBe(first);
  expect(first.getAttribute("aria-checked")).toBe("true");
  fireEvent.keyDown(first, { key: "End" });
  expect(document.activeElement).toBe(second);
  fireEvent.keyDown(second, { key: "Home" });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: "ArrowUp" });
  expect(document.activeElement).toBe(second);
  fireEvent.keyDown(second, { key: "Escape" });
  expect(view.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(view.selectDeployment).not.toHaveBeenCalled();
  fireEvent.keyDown(trigger, { key: "ArrowUp" });
  expect(document.activeElement).toBe(view.getByRole("menuitemradio", { name: "Model B" }));
  fireEvent.click(document.activeElement!);
  await waitFor(() => expect(view.state.deployment.selection?.model).toBe("b"));
});

it("dismisses menus on outside presses and keeps only the focused picker open", async () => {
  const view = setup();

  const model = await view.findByRole("button", { name: "Model: Model A" });

  await waitFor(() => expect((model as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(model);
  fireEvent.pointerDown(document.body);
  expect(view.queryByRole("menu")).toBeNull();
  fireEvent.click(model);
  fireEvent.click(view.getByRole("button", { name: "CLI: Codex CLI" }));
  expect(view.getAllByRole("menu")).toHaveLength(1);
  expect(view.getByRole("menu", { name: "CLI" })).toBeTruthy();
  expect(view.getByRole("menuitem", { name: /Connect CLI/ })).toBeTruthy();
});

it("explains deployment on hover or focus without launching and dismisses on Escape", async () => {
  const view = setup();
  const info = view.getByRole("button", { name: "About CLI deployment" });

  expect(view.queryByRole("tooltip")).toBeNull();
  fireEvent.mouseEnter(info);
  expect(view.getByRole("tooltip").textContent).toContain("Context Folder");
  expect(info.getAttribute("aria-describedby")).toBe(view.getByRole("tooltip").id);
  fireEvent.mouseLeave(info);
  expect(view.queryByRole("tooltip")).toBeNull();
  fireEvent.focus(info);
  expect(view.getByRole("tooltip")).toBeTruthy();
  fireEvent.keyDown(info, { key: "Escape" });
  expect(view.queryByRole("tooltip")).toBeNull();
  expect(view.deploy).not.toHaveBeenCalled();
  await waitFor(() => expect(view.getByRole("button", { name: "CLI: Codex CLI" })).toBeTruthy());
});
