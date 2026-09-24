// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import messages from "@path/shared/messages/en.json";
import { TimelineTabs, type TimelineTab } from "../src/components/TimelineTabs";

afterEach(cleanup);

function ControlledTabs() {
  const [tab, setTab] = useState<TimelineTab>("activity");

  return <TimelineTabs value={tab} onChange={setTab} />;
}

function renderTabs() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <ControlledTabs />
    </NextIntlClientProvider>,
  );
}

function selectedTab(): string | null {
  return screen.getByRole("tab", { selected: true }).textContent;
}

describe("TimelineTabs", () => {
  it("renders Activity, Logs, and Elements with only the selected tab focusable", () => {
    renderTabs();

    const tabs = screen.getAllByRole("tab");

    expect(tabs.map((tab) => tab.textContent)).toEqual(["Activity", "Logs", "Elements"]);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
    expect(tabs[0]?.getAttribute("aria-controls")).toBe("timeline-panel-activity");
    expect(tabs[1]?.getAttribute("aria-controls")).toBeNull();
  });

  it("selects tabs by click and moves focus with arrows, Home, and End", () => {
    renderTabs();

    fireEvent.click(screen.getByRole("tab", { name: "Logs" }));
    expect(selectedTab()).toBe("Logs");

    fireEvent.keyDown(screen.getByRole("tab", { name: "Logs" }), { key: "ArrowRight" });
    expect(selectedTab()).toBe("Elements");
    expect(document.activeElement?.textContent).toBe("Elements");

    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(selectedTab()).toBe("Activity");

    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(selectedTab()).toBe("Elements");

    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(selectedTab()).toBe("Activity");

    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(selectedTab()).toBe("Elements");
    expect(document.activeElement?.textContent).toBe("Elements");
  });
});
