import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PathLinkNotifications } from "../src/links/PathLinkNotifications";

const native = vi.hoisted(() => ({
  isSupported: vi.fn(() => true),
  show: vi.fn(),
  instances: [] as Array<{
    options: { title: string; body: string };
    emit: (event: string) => boolean;
  }>,
}));

vi.mock("electron", () => ({
  Notification: class extends EventEmitter {
    static isSupported = native.isSupported;
    constructor(readonly options: { title: string; body: string }) {
      super();
      native.instances.push(this);
    }
    show = native.show;
  },
}));

beforeEach(() => {
  native.instances.length = 0;
  native.isSupported.mockReturnValue(true);
  native.show.mockReset();
});

describe("PathLinkNotifications", () => {
  it("reports a running app and opens it when the status notification is clicked", () => {
    const open = vi.fn();
    const notifications = new PathLinkNotifications(open, {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    });

    notifications.showStatus();
    expect(native.show).toHaveBeenCalledOnce();
    expect(native.instances[0]?.options).toEqual({
      title: "Path — Status",
      body: "Path is running.",
    });
    native.instances[0]?.emit("click");
    expect(open).toHaveBeenCalledWith(undefined);
  });

  it("sends native notifications at each stage and opens the referenced recording on click", () => {
    const open = vi.fn();
    const notifications = new PathLinkNotifications(open, {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    });

    notifications.show("starting", "Walkthrough");
    notifications.show("processing", "Walkthrough", "recording");
    notifications.show("complete", "Walkthrough", "recording");
    notifications.show("failed", "Provider unavailable", "recording");
    expect(native.show).toHaveBeenCalledTimes(4);
    expect(native.instances.map((instance) => instance.options.title)).toEqual([
      "Path — Starting import",
      "Path — Processing recording",
      "Path — Complete",
      "Path — Could not complete request",
    ]);
    native.instances[2]?.emit("click");
    expect(open).toHaveBeenCalledWith("recording");
  });

  it("does not fail processing when the OS cannot display a notification", () => {
    const diagnostics = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const notifications = new PathLinkNotifications(vi.fn(), diagnostics);

    native.isSupported.mockReturnValue(false);
    expect(() => notifications.show("starting", "Walkthrough")).not.toThrow();
    expect(native.show).not.toHaveBeenCalled();
    native.isSupported.mockReturnValue(true);
    native.show.mockImplementationOnce(() => {
      throw new Error("OS notification error");
    });
    expect(() => notifications.show("processing", "Walkthrough")).not.toThrow();
    notifications.show("complete", "Walkthrough");
    expect(() => native.instances[1]?.emit("failed")).not.toThrow();
    expect(diagnostics.warn).toHaveBeenCalledTimes(3);
  });
});
