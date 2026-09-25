// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import messages from "@path/shared/messages/en.json";
import { CliToolPicker } from "../src/components/CliToolPicker";
import type { useCliTools } from "../src/hooks/useCliTools";

afterEach(cleanup);
function setup() {
  const cli: ReturnType<typeof useCliTools> = {
    state: {
      mode: "model",
      revision: 1,
      connected: ["claude"],
      selection: null,
      tools: [
        {
          id: "claude",
          installed: true,
          connected: true,
          status: "ready",
          models: [
            {
              id: "opus",
              name: "Opus",
              description: "Reported description",
              efforts: ["low", "high"],
            },
            { id: "haiku", name: "Haiku", description: "", efforts: [] },
          ],
        },
        { id: "muse", installed: false, connected: false, status: "not-installed", models: [] },
      ],
    },
    busy: false,
    error: null,
    refresh: vi.fn(async () => true),
    connect: vi.fn(async () => true),
    select: vi.fn(async () => true),
    setMode: vi.fn(async () => true),
    openSettings: vi.fn(async () => {}),
  };

  const renderPicker = () => (
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <CliToolPicker cli={cli} />
    </NextIntlClientProvider>
  );

  const view = render(renderPicker());

  vi.mocked(cli.select).mockImplementation(async (selection) => {
    cli.state = { ...cli.state!, mode: "cli", selection };
    view.rerender(renderPicker());

    return true;
  });

  return { ...view, cli };
}

it("selects models and supported efforts immediately with persistent checkmarks", async () => {
  const view = setup();

  fireEvent.click(view.getByRole("button", { name: "Claude Code Connected" }));
  fireEvent.click(view.getByRole("menuitemradio", { name: "Opus" }));
  await waitFor(() =>
    expect(view.getByRole("menuitemradio", { name: "Opus" }).getAttribute("aria-checked")).toBe(
      "true",
    ),
  );
  expect(view.cli.select).toHaveBeenCalledWith({ tool: "claude", model: "opus", effort: null });
  fireEvent.click(view.getByRole("menuitemradio", { name: "High" }));
  await waitFor(() =>
    expect(view.getByRole("menuitemradio", { name: "High" }).getAttribute("aria-checked")).toBe(
      "true",
    ),
  );
  expect(view.cli.select).toHaveBeenLastCalledWith({
    tool: "claude",
    model: "opus",
    effort: "high",
  });
  fireEvent.click(view.getByRole("menuitemradio", { name: "Haiku" }));
  await waitFor(() => expect(view.queryByRole("menuitemradio", { name: "High" })).toBeNull());
  expect(view.getByText("This model uses its default reasoning.")).toBeTruthy();
  expect(view.cli.select).toHaveBeenLastCalledWith({
    tool: "claude",
    model: "haiku",
    effort: null,
  });
  expect(view.queryByRole("button", { name: "Use CLI" })).toBeNull();
  expect(view.queryByRole("combobox")).toBeNull();
});

it("filters by model or tool and keeps matching headers togglable", () => {
  const view = setup();
  const search = view.getByRole("textbox", { name: "Search models…" });

  fireEvent.change(search, { target: { value: "OPUS" } });
  expect(view.getByRole("menuitemradio", { name: "Opus" })).toBeTruthy();
  expect(view.queryByRole("menuitemradio", { name: "Haiku" })).toBeNull();
  const header = view.getByRole("button", { name: "Claude Code Connected" });

  fireEvent.click(header);
  expect(view.queryByRole("menuitemradio", { name: "Opus" })).toBeNull();
  fireEvent.click(header);
  expect(view.getByRole("menuitemradio", { name: "Opus" })).toBeTruthy();
  fireEvent.change(search, { target: { value: "facebook" } });
  expect(view.queryByRole("button", { name: "Claude Code Connected" })).toBeNull();
  expect(view.getByRole("button", { name: "Facebook Muse Not connected" })).toBeTruthy();
  fireEvent.change(search, { target: { value: "missing" } });
  expect(view.getByRole("status").textContent).toBe("No matching models");
  fireEvent.click(view.getByRole("button", { name: "Clear model search" }));
  expect(document.activeElement).toBe(search);
});

it("offers connection settings for disconnected tools and collapses effort choices", () => {
  const view = setup();

  fireEvent.click(view.getByRole("button", { name: "Facebook Muse Not connected" }));
  fireEvent.click(view.getByRole("button", { name: "Connect in Settings" }));
  expect(view.cli.openSettings).toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: "Reasoning effort" }));
  expect(view.queryByRole("menu", { name: "Reasoning effort" })).toBeNull();
});

it("does not check a model when saving fails", async () => {
  const view = setup();

  vi.mocked(view.cli.select).mockResolvedValue(false);
  fireEvent.click(view.getByRole("button", { name: "Claude Code Connected" }));
  fireEvent.click(view.getByRole("menuitemradio", { name: "Opus" }));
  await waitFor(() => expect(view.cli.select).toHaveBeenCalled());
  expect(view.getByRole("menuitemradio", { name: "Opus" }).getAttribute("aria-checked")).toBe(
    "false",
  );
});
