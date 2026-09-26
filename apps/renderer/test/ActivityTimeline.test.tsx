// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import messages from "@path/shared/messages/en.json";
import { ActivityTimeline } from "../src/components/ActivityTimeline";
import { TimelineTabs } from "../src/components/TimelineTabs";

afterEach(cleanup);

function renderTimeline({
  processing = false,
  canRetryAnalysis = false,
}: {
  processing?: boolean;
  canRetryAnalysis?: boolean;
} = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <ActivityTimeline
        tabs={<TimelineTabs value="activity" onChange={vi.fn()} />}
        recordingSelected={false}
        timeline={[]}
        allCount={3}
        clickCount={2}
        speechCount={1}
        filter="all"
        query=""
        selectedActivityKey={null}
        activePlaybackKey={null}
        playing={false}
        pendingIds={[]}
        processing={processing}
        error={null}
        emptyLabel="Nothing here"
        canRetryAnalysis={canRetryAnalysis}
        listRef={{ current: null }}
        onScrollPause={vi.fn()}
        onFilterChange={vi.fn()}
        onQueryChange={vi.fn()}
        onRetryAnalysis={vi.fn()}
        onSelectClick={vi.fn()}
        onSelectTranscript={vi.fn()}
        onFocusActivity={vi.fn()}
        onSaveClickDescription={vi.fn()}
        onSaveTranscript={vi.fn()}
        onRemoveClick={vi.fn()}
        onRemoveTranscript={vi.fn()}
        onOpenScreenshot={vi.fn()}
        onInsertScreenshot={vi.fn()}
        onPreviewScreenshot={vi.fn()}
        onPreviewEnd={vi.fn()}
        onUserScrollChange={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

describe("ActivityTimeline header", () => {
  it("renders the title without a count and places search beside the filter", () => {
    const view = renderTimeline();

    expect(view.getByText("Activity")).toBeTruthy();
    expect(view.queryByText(/events?/)).toBeNull();

    const toolbar = view.container.querySelector(".activity-toolbar");

    expect(toolbar).toBeTruthy();
    expect(toolbar?.querySelector("input[aria-label='Search transcript']")).toBeTruthy();

    const trigger = view.getByRole("button", { name: "Filter activity timeline" });

    expect(toolbar?.contains(trigger)).toBe(true);
    expect(trigger.textContent).toContain("All (3)");
    expect(view.queryByRole("button", { name: "Retry analysis" })).toBeNull();
  });

  it("replaces activity controls with a spinner while processing", () => {
    const view = renderTimeline({ processing: true });

    expect(view.getByRole("progressbar", { name: "Processing Activities..." })).toBeTruthy();
    expect(view.queryByRole("textbox", { name: "Search transcript" })).toBeNull();
    expect(view.queryByText("Nothing here")).toBeNull();
  });

  it("keeps the retry action in the title row when analysis can be retried", () => {
    const view = renderTimeline({ canRetryAnalysis: true });
    const header = view.container.querySelector(".transcript-panel > header");
    const retry = view.getByRole("button", { name: "Retry analysis" });

    expect(header?.contains(retry)).toBe(true);
  });
});
