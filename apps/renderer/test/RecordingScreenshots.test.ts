// @vitest-environment jsdom

import { createElement } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScreenshotAction } from "../src/components/ScreenshotAction";
import { ScreenshotImage } from "../src/components/ScreenshotImage";
import { capturedClick } from "./WorkspaceFixtures";

const bridge = vi.hoisted(() => ({ screenshotUrl: vi.fn() }));

vi.mock("@/lib/Desktop", () => ({ getDesktopApi: () => ({ recordings: bridge }) }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

// Tests release image loads explicitly to expose geometry retained from a previous screenshot.
class TestImage extends EventTarget {
  static instances: TestImage[] = [];
  src = "";
  naturalWidth = 1920;
  naturalHeight = 1080;

  constructor() {
    super();
    TestImage.instances.push(this);
  }
}

class TestResizeObserver implements ResizeObserver {
  static instances: TestResizeObserver[] = [];
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();

  constructor(readonly callback: ResizeObserverCallback) {
    TestResizeObserver.instances.push(this);
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  TestImage.instances = [];
  TestResizeObserver.instances = [];
  vi.stubGlobal("Image", TestImage);
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  bridge.screenshotUrl.mockImplementation(
    async ({ recordingId }: { recordingId: string }) =>
      `https://media.test/${recordingId}/click.webp`,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("recording screenshot lifecycle", () => {
  it("keeps preview and open actions attached to the current recording's screenshot", async () => {
    const firstLookup = Promise.withResolvers<string>();

    bridge.screenshotUrl.mockReturnValueOnce(firstLookup.promise);
    const props = {
      click: capturedClick("recording-a"),
      onOpen: vi.fn(),
      onPreview: vi.fn(),
      onPreviewEnd: vi.fn(),
    };

    const view = render(createElement(ScreenshotAction, props));

    view.rerender(
      createElement(ScreenshotAction, { ...props, click: capturedClick("recording-b") }),
    );
    await waitFor(() => expect(view.queryByRole("button")).not.toBeNull());
    await act(async () => firstLookup.resolve("https://media.test/recording-a/click.webp"));
    fireEvent.click(view.getByRole("button"));
    fireEvent.focus(view.getByRole("button"));

    expect(props.onOpen).toHaveBeenCalledWith("https://media.test/recording-b/click.webp");
    expect(props.onPreview).toHaveBeenCalledWith(
      "https://media.test/recording-b/click.webp",
      expect.anything(),
    );

    view.rerender(
      createElement(ScreenshotAction, {
        ...props,
        click: { ...capturedClick("recording-b"), actionDescription: "Menu" },
      }),
    );

    expect(bridge.screenshotUrl).toHaveBeenCalledTimes(2);
  });

  it("hides an old screenshot immediately during a new lookup and handles unavailable screenshots", async () => {
    const props = {
      click: capturedClick("recording-a"),
      onOpen: vi.fn(),
      onPreview: vi.fn(),
      onPreviewEnd: vi.fn(),
    };

    const view = render(createElement(ScreenshotAction, props));

    await waitFor(() => expect(view.queryByRole("button")).not.toBeNull());
    const unavailable = Promise.withResolvers<string>();

    bridge.screenshotUrl.mockReturnValue(unavailable.promise);
    view.rerender(
      createElement(ScreenshotAction, { ...props, click: capturedClick("recording-b") }),
    );

    expect(view.queryByRole("button")).toBeNull();

    await act(async () => unavailable.reject(new Error("Screenshot unavailable")));

    expect(view.queryByRole("button")).toBeNull();
  });

  it("uses geometry from the current image and releases image and resize listeners", () => {
    const props = {
      click: capturedClick("recording-a"),
      url: "https://media.test/a.webp",
      showHotspot: true,
    };

    const view = render(createElement(ScreenshotImage, props));
    const container = view.container.firstElementChild;

    if (!container) throw new Error("Expected a screenshot container");

    Object.defineProperties(container, {
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
    });
    act(() => TestImage.instances[0].dispatchEvent(new Event("load")));

    expect(container.querySelector("span")?.style.left).toBe("80px");
    expect(container.querySelector("span")?.style.top).toBe("105px");

    view.rerender(createElement(ScreenshotImage, { ...props, url: "https://media.test/b.webp" }));

    expect(container.querySelector("span")).toBeNull();

    act(() => TestImage.instances[0].dispatchEvent(new Event("load")));

    expect(container.querySelector("span")).toBeNull();

    act(() => TestImage.instances[1].dispatchEvent(new Event("load")));

    expect(container.querySelector("span")?.style.left).toBe("80px");

    const removeListener = vi.spyOn(TestImage.instances[1], "removeEventListener");

    view.unmount();

    expect(
      TestResizeObserver.instances.every((observer) => observer.disconnect.mock.calls.length === 1),
    ).toBe(true);
    expect(removeListener).toHaveBeenCalledWith("load", expect.any(Function));
  });
});
