// @vitest-environment jsdom

import { cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOutsidePointerDown } from "../src/hooks/useOutsidePointerDown";

let menu: HTMLDivElement;
let trigger: HTMLButtonElement;
let outside: HTMLDivElement;

beforeEach(() => {
  menu = document.createElement("div");
  menu.append(document.createElement("button"));
  trigger = document.createElement("button");
  outside = document.createElement("div");
  document.body.append(menu, trigger, outside);
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

describe("useOutsidePointerDown", () => {
  it("dismisses only for presses outside every inside element", () => {
    const onOutside = vi.fn();

    renderHook(() =>
      useOutsidePointerDown(true, [{ current: menu }, { current: trigger }], onOutside),
    );

    fireEvent.pointerDown(menu.firstElementChild!);
    fireEvent.pointerDown(trigger);
    expect(onOutside).not.toHaveBeenCalled();

    fireEvent.pointerDown(outside);
    expect(onOutside).toHaveBeenCalledTimes(1);
  });

  it("listens only while active and releases the listener on unmount", () => {
    const onOutside = vi.fn();
    const view = renderHook(
      ({ isActive }) => useOutsidePointerDown(isActive, [{ current: menu }], onOutside),
      { initialProps: { isActive: false } },
    );

    fireEvent.pointerDown(outside);
    expect(onOutside).not.toHaveBeenCalled();

    view.rerender({ isActive: true });
    fireEvent.pointerDown(outside);
    expect(onOutside).toHaveBeenCalledTimes(1);

    view.unmount();
    fireEvent.pointerDown(outside);
    expect(onOutside).toHaveBeenCalledTimes(1);
  });

  it("calls the latest dismissal callback without resubscribing", () => {
    const first = vi.fn();
    const second = vi.fn();
    const view = renderHook(
      ({ onOutside }) => useOutsidePointerDown(true, [{ current: menu }], onOutside),
      { initialProps: { onOutside: first } },
    );

    view.rerender({ onOutside: second });
    fireEvent.pointerDown(outside);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
