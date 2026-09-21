import { describe, expect, it } from "vitest";
import {
  needsClickActionAnalysis,
  normalizeClickDescription,
  UNKNOWN_CLICK_CONTROL,
} from "../src/ClickDescription";

describe("click descriptions", () => {
  it("retries missing and rejected descriptions, not a terminal unknown control", () => {
    expect(needsClickActionAnalysis(null)).toBe(true);
    expect(needsClickActionAnalysis("   ")).toBe(true);
    expect(needsClickActionAnalysis("I need the screenshot to identify the UI control")).toBe(true);
    expect(needsClickActionAnalysis("Submit button")).toBe(false);
    expect(needsClickActionAnalysis(UNKNOWN_CLICK_CONTROL)).toBe(false);
    expect(needsClickActionAnalysis(`  ${UNKNOWN_CLICK_CONTROL}  `)).toBe(false);
  });

  it.each([
    ["left", "Dismiss button", "The user clicks the Dismiss button."],
    ["right", "Selected file", "The user right-clicks the Selected file."],
    ["middle", "Browser tab", "The user middle-clicks the Browser tab."],
  ] as const)(
    "expands a terse %s-click label into a guide sentence",
    (button, response, expected) => {
      expect(normalizeClickDescription(response, button)).toBe(expected);
    },
  );

  it("rejects non-answers and descriptions beyond the shared limit", () => {
    expect(normalizeClickDescription("I cannot identify the object.")).toBe(UNKNOWN_CLICK_CONTROL);
    expect(
      normalizeClickDescription(
        "The user clicks a control and then continues describing irrelevant details that make this response far too long for a concise help guide action label and should be rejected",
      ),
    ).toBe(UNKNOWN_CLICK_CONTROL);
  });
});
