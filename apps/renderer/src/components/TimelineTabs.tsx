import { useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import type { TimelineImportKind } from "@path/shared";

export type TimelineTab = "activity" | TimelineImportKind;

const TIMELINE_TABS: TimelineTab[] = ["activity", "log", "element"];

const TAB_LABEL_KEYS = {
  activity: "activity",
  log: "logs",
  element: "elements",
} as const satisfies Record<TimelineTab, string>;

export function timelineTabId(tab: TimelineTab): string {
  return `timeline-tab-${tab}`;
}

export function timelinePanelId(tab: TimelineTab): string {
  return `timeline-panel-${tab}`;
}

/** Horizontal review tabs below the video; arrow keys, Home, and End move focus and selection. */
export function TimelineTabs({
  value,
  onChange,
}: {
  value: TimelineTab;
  onChange(tab: TimelineTab): void;
}) {
  const t = useTranslations("recording");
  const tabRefs = useRef<Partial<Record<TimelineTab, HTMLButtonElement | null>>>({});

  function navigateTabs(event: ReactKeyboardEvent<HTMLButtonElement>): void {
    const currentIndex = TIMELINE_TABS.indexOf(value);
    let nextIndex: number;

    if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = TIMELINE_TABS.length - 1;
    } else if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % TIMELINE_TABS.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + TIMELINE_TABS.length) % TIMELINE_TABS.length;
    } else {
      return;
    }

    const nextTab = TIMELINE_TABS[nextIndex] ?? value;

    event.preventDefault();
    onChange(nextTab);
    tabRefs.current[nextTab]?.focus();
  }

  return (
    <div className="timeline-tabs" role="tablist" aria-label={t("reviewTabs")}>
      {TIMELINE_TABS.map((tab) => (
        <button
          key={tab}
          ref={(element) => {
            tabRefs.current[tab] = element;
          }}
          type="button"
          role="tab"
          id={timelineTabId(tab)}
          // Only the selected tab's panel is rendered.
          aria-controls={tab === value ? timelinePanelId(tab) : undefined}
          aria-selected={tab === value}
          tabIndex={tab === value ? 0 : -1}
          onClick={() => onChange(tab)}
          onKeyDown={navigateTabs}
        >
          {t(TAB_LABEL_KEYS[tab])}
        </button>
      ))}
    </div>
  );
}
