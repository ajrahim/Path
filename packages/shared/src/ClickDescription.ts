import type { MouseButton } from "./Contracts";

/** Persisted when a screenshot cannot identify a control. This result is terminal. */
export const UNKNOWN_CLICK_CONTROL = "Unknown control";

const MAX_CLICK_DESCRIPTION_WORDS = 24;
const MAX_CLICK_DESCRIPTION_LENGTH = 180;
const SHORT_CLICK_DESCRIPTION_WORDS = 6;

const NON_ANSWER_PATTERN =
  /\b(?:cannot|can't|unable|no screenshot|need (?:the|a) screenshot|screenshot (?:was not|is not|isn't|were not)|image (?:was not|is not|isn't)|not provided|unavailable|lack access|identify the ui control)\b/i;

/** A missing or rejected description can be analyzed; an explicit unknown control cannot. */
export function needsClickActionAnalysis(description: string | null): boolean {
  if (!description?.trim()) return true;

  if (description.trim() === UNKNOWN_CLICK_CONTROL) return false;

  return normalizeClickDescription(description) === UNKNOWN_CLICK_CONTROL;
}

/** Publish one reliable sentence, or the terminal unknown-control result. */
export function normalizeClickDescription(
  content: string | undefined,
  button?: MouseButton,
): string {
  const description = content
    ?.trim()
    .split(/\r?\n/, 1)[0]
    ?.replace(/^[*_'"`\[(]+|[*_'"`\])]+$/g, "")
    .replace(/^(?:target|answer|clicked)\s*:\s*/i, "")
    .replace(/[.!]+$/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!description || NON_ANSWER_PATTERN.test(description)) {
    return UNKNOWN_CLICK_CONTROL;
  }

  const words = description.split(" ");

  if (
    words.length > MAX_CLICK_DESCRIPTION_WORDS ||
    description.length > MAX_CLICK_DESCRIPTION_LENGTH
  ) {
    return UNKNOWN_CLICK_CONTROL;
  }

  if (
    button &&
    words.length <= SHORT_CLICK_DESCRIPTION_WORDS &&
    !/^the user\b/i.test(description)
  ) {
    return `The user ${clickVerb(button)} the ${description}.`;
  }

  return `${description}.`;
}

function clickVerb(button: MouseButton): string {
  if (button === "right") return "right-clicks";
  if (button === "middle") return "middle-clicks";

  return "clicks";
}
