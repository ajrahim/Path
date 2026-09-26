// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOnboarding } from "../src/hooks/useOnboarding";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useOnboarding", () => {
  it("opens on a fresh installation and stays closed once completed", () => {
    const first = renderHook(() => useOnboarding());

    expect(first.result.current.isOpen).toBe(true);

    act(() => first.result.current.complete());
    expect(first.result.current.isOpen).toBe(false);
    expect(window.localStorage.getItem("path.onboarding")).toBe("complete");

    first.unmount();

    expect(renderHook(() => useOnboarding()).result.current.isOpen).toBe(false);
  });

  it("closes for this session when storing completion fails", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    const logError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { result } = renderHook(() => useOnboarding());

    act(() => result.current.complete());

    expect(result.current.isOpen).toBe(false);
    expect(logError).toHaveBeenCalledOnce();
    expect(window.localStorage.getItem("path.onboarding")).toBeNull();
  });
});
