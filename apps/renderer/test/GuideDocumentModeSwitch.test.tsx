// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import messages from "@path/shared/messages/en.json";
import { GuideDocumentModeSwitch } from "../src/components/GuideDocumentModeSwitch";

afterEach(cleanup);

it.each(["combine", "split"] as const)("exposes %s mode and requests the other mode", (mode) => {
  const onModeChange = vi.fn();

  const view = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <GuideDocumentModeSwitch mode={mode} disabled={false} onModeChange={onModeChange} />
    </NextIntlClientProvider>,
  );

  const toggle = view.getByRole("switch", { name: "Split" });

  expect(toggle.getAttribute("aria-checked")).toBe(String(mode === "split"));
  expect(view.getByText("Combine")).toBeTruthy();
  expect(view.getByText("Split")).toBeTruthy();
  fireEvent.click(toggle);
  expect(onModeChange).toHaveBeenCalledWith(mode === "split" ? "combine" : "split");
});

it("blocks mode changes while disabled", () => {
  const onModeChange = vi.fn();
  const view = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <GuideDocumentModeSwitch mode="combine" disabled onModeChange={onModeChange} />
    </NextIntlClientProvider>,
  );

  fireEvent.click(view.getByRole("switch", { name: "Split" }));
  expect(onModeChange).not.toHaveBeenCalled();
});
