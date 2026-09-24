// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUILT_IN_FLOWS, type InstructionFlow } from "@path/shared";
import messages from "@path/shared/messages/en.json";
import { InstructionFlowSelect } from "../src/components/InstructionFlowSelect";

const helpGuide: InstructionFlow = {
  id: "help-guide",
  name: "Help Guide",
  instructions: "Write a help guide.",
  icon: "book-open",
};

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

function renderSelect(
  variant?: "field" | "title",
  customFlows: InstructionFlow[] = [],
  selectedFlow = helpGuide,
) {
  const onSelect = vi.fn();
  const onEdit = vi.fn();
  const view = render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <InstructionFlowSelect
        triggerRef={{ current: null }}
        variant={variant}
        selectedFlow={selectedFlow}
        builtInFlows={BUILT_IN_FLOWS.map((flow) =>
          flow.id === selectedFlow.id ? selectedFlow : flow,
        )}
        customFlows={customFlows}
        disabled={false}
        onSelect={onSelect}
        onEdit={onEdit}
      />
    </NextIntlClientProvider>,
  );

  return { view, onSelect, onEdit };
}

describe("InstructionFlowSelect", () => {
  it("renders a content-fit title trigger without an embedded edit button", () => {
    const { view } = renderSelect("title");

    expect(view.container.querySelector(".guide-flow-select-title")).toBeTruthy();
    expect(
      view.getByRole("button", { name: "Document instruction flow: Help Guide" }).textContent,
    ).toContain("Help Guide");
    expect(view.queryByRole("button", { name: "Edit prompt" })).toBeNull();
  });

  it("selects another flow from the title menu", () => {
    const { view, onSelect } = renderSelect("title");

    fireEvent.click(view.getByRole("button", { name: "Document instruction flow: Help Guide" }));
    fireEvent.click(view.getByRole("menuitemradio", { name: "Spec Document" }));

    expect(onSelect).toHaveBeenCalledWith("spec-document");
    expect(view.queryByRole("menu")).toBeNull();
  });

  it("keeps the embedded edit button in field mode", () => {
    const { view, onEdit } = renderSelect();

    fireEvent.click(view.getByRole("button", { name: "Edit prompt" }));

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(view.queryByRole("menu")).toBeNull();
  });

  it("hides the custom prompts group when no custom flows exist", () => {
    const { view } = renderSelect("title");

    fireEvent.click(view.getByRole("button", { name: "Document instruction flow: Help Guide" }));

    expect(view.queryByText("Custom prompts")).toBeNull();
    expect(view.getByRole("menuitem", { name: "Add New Instruction" })).toBeTruthy();
  });

  it("shows the custom prompts group when custom flows exist", () => {
    const custom: InstructionFlow = {
      id: "custom-1",
      name: "QA Checklist",
      instructions: "Check everything.",
      icon: "list-checks",
    };

    const { view, onSelect } = renderSelect("title", [custom]);

    fireEvent.click(view.getByRole("button", { name: "Document instruction flow: Help Guide" }));

    expect(view.getByText("Custom prompts")).toBeTruthy();
    fireEvent.click(view.getByRole("menuitemradio", { name: "QA Checklist" }));

    expect(onSelect).toHaveBeenCalledWith("custom-1");
  });

  it("uses saved icons for the selected default and custom menu options", () => {
    const custom: InstructionFlow = {
      id: "custom-1",
      name: "QA review",
      instructions: "Review quality.",
      icon: "bug",
    };

    const { view } = renderSelect("title", [custom], { ...helpGuide, icon: "lightbulb" });
    const trigger = view.getByRole("button", { name: "Document instruction flow: Help Guide" });

    expect(trigger.querySelector(".lucide-lightbulb")).toBeTruthy();
    fireEvent.click(trigger);
    expect(
      view.getByRole("menuitemradio", { name: "Help Guide" }).querySelector(".lucide-lightbulb"),
    ).toBeTruthy();
    expect(
      view.getByRole("menuitemradio", { name: "QA review" }).querySelector(".lucide-bug"),
    ).toBeTruthy();
  });
});
