// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import messages from "@path/shared/messages/en.json";
import { LocalModelSelect } from "../src/components/LocalModelSelect";

const selectModel = vi.hoisted(() => vi.fn().mockResolvedValue(true));

vi.mock("../src/hooks/useAiModels", () => ({
  useAiModels: () => ({
    models: {
      api: [{ id: "cloud-vision", name: "Cloud Vision", provider: "openai" }],
      local: [
        { id: "llama:latest", name: "Llama Vision" },
        { id: "gemma:latest", name: "Gemma" },
      ],
    },
    keyStatus: { openai: true, google: false, anthropic: false },
    selection: { source: "local", modelId: "llama:latest", modelName: "Llama Vision" },
    isLoading: false,
    isSaving: false,
    error: null,
    refreshModels: vi.fn(),
    selectModel,
  }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function setup() {
  const view = render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <LocalModelSelect disabled={false} />
    </NextIntlClientProvider>,
  );

  fireEvent.click(view.getByRole("button", { name: "Select AI model" }));

  return view;
}

it("searches local model IDs and API provider names, then selects the matching API model", async () => {
  const view = setup();
  const search = view.getByRole("textbox", { name: messages.navigation.searchModels });

  expect(document.activeElement).toBe(search);
  fireEvent.change(search, { target: { value: " LLAMA: " } });
  expect(view.getByRole("menuitemradio", { name: "Llama Vision" })).toBeTruthy();
  expect(view.queryByRole("menuitemradio", { name: "Gemma" })).toBeNull();
  fireEvent.change(search, { target: { value: "openai" } });
  expect(view.getByRole("button", { name: /^OpenAI/ }).getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(view.getByRole("menuitemradio", { name: "Cloud Vision" }));
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  expect(selectModel).toHaveBeenCalledWith({
    source: "api",
    provider: "openai",
    modelId: "cloud-vision",
    modelName: "Cloud Vision",
  });
  expect(document.activeElement).toBe(view.getByRole("button", { name: "Select AI model" }));
});

it("handles no results, clears the query, and resets it when reopening without changing selection", () => {
  const view = setup();
  const search = view.getByRole("textbox", { name: messages.navigation.searchModels });

  fireEvent.change(search, { target: { value: "missing-model" } });
  expect(view.getByRole("status").textContent).toBe("No matching models");
  fireEvent.click(view.getByRole("button", { name: "Clear model search" }));
  expect(document.activeElement).toBe(search);
  expect(
    view.getByRole("menuitemradio", { name: "Llama Vision" }).getAttribute("aria-checked"),
  ).toBe("true");
  fireEvent.change(search, { target: { value: "gemma" } });
  fireEvent.keyDown(search, { key: "Escape" });
  expect(view.queryByRole("dialog")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Select AI model" }));
  expect(
    (view.getByRole("textbox", { name: messages.navigation.searchModels }) as HTMLInputElement)
      .value,
  ).toBe("");
  expect(selectModel).not.toHaveBeenCalled();
});
