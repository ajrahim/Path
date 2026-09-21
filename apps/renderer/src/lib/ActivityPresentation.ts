import type { useTranslations } from "next-intl";
import {
  needsClickActionAnalysis,
  UNKNOWN_CLICK_CONTROL,
  type ClickEvent,
  type MouseButton,
} from "@path/shared";

type Translator = ReturnType<typeof useTranslations>;

export const CLICK_HOTSPOT_WINDOW_MS = 600;
export const ACTIVITY_SCROLL_PAUSE_MS = 1_500;
export const PLAYBACK_SEEK_STEP_SECONDS = 3;

export function clickLabel(t: Translator, button: MouseButton): string {
  if (button === "right") return t("recording.rightClick");
  if (button === "middle") return t("recording.middleClick");

  return t("recording.leftClick");
}

/** Show the stored sentence, or the translated terminal result. Analysis owns validity. */
function clickActionDescription(t: Translator, click: ClickEvent): string | null {
  const description = click.actionDescription?.trim();

  if (!description) return null;
  if (description === UNKNOWN_CLICK_CONTROL || needsClickActionAnalysis(description)) {
    return t("recording.unknownControl");
  }

  return description;
}

export function displayedClickAction(t: Translator, click: ClickEvent): string {
  return clickActionDescription(t, click) ?? clickLabel(t, click.button);
}
