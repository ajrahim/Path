// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import messages from "@path/shared/messages/en.json";
import { ActivityTypeSelect } from "../src/components/ActivityTypeSelect";

afterEach(cleanup);

it("focuses the selected filter, supports keyboard navigation, and dismisses without changing it", () => {
  const onChange = vi.fn();
  const view = render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <ActivityTypeSelect
        value="clicks"
        counts={{ all: 9, clicks: 5, speech: 4 }}
        onChange={onChange}
      />
    </NextIntlClientProvider>,
  );

  const trigger = view.getByRole("button", { name: messages.recording.filterActivity });

  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const clicks = view.getByRole("menuitemradio", { name: "Clicks (5)" });

  expect(document.activeElement).toBe(clicks);
  expect(clicks.getAttribute("aria-checked")).toBe("true");
  fireEvent.keyDown(clicks, { key: "s" });
  const speech = view.getByRole("menuitemradio", { name: "Speech (4)" });

  expect(document.activeElement).toBe(speech);
  fireEvent.keyDown(speech, { key: "Escape" });
  expect(view.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.keyDown(trigger, { key: "ArrowUp" });
  expect(document.activeElement).toBe(view.getByRole("menuitemradio", { name: "Speech (4)" }));
  fireEvent.keyDown(document.activeElement!, { key: "Home" });
  expect(document.activeElement).toBe(view.getByRole("menuitemradio", { name: "All (9)" }));
  fireEvent.click(document.activeElement!);
  expect(onChange).toHaveBeenCalledWith("all");
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  fireEvent.pointerDown(document.body);
  expect(view.queryByRole("menu")).toBeNull();
  fireEvent.click(trigger);
  fireEvent(window, new Event("resize"));
  expect(view.queryByRole("menu")).toBeNull();
});
