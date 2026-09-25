import { EventEmitter } from "node:events";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PathProtocol } from "../src/links/PathProtocol";
import type { PathAppLink } from "../src/links/PathAppLink";

function createProtocol(argv: string[] = [], isPackaged = false) {
  const app = Object.assign(new EventEmitter(), {
    isPackaged,
    getAppPath: () => resolve("apps/desktop"),
    setAsDefaultProtocolClient: vi.fn(() => true),
  });

  const protocol = new PathProtocol({ app, argv, executablePath: "electron.exe" });

  return { app, protocol };
}

function link(title: string): string {
  return `pathai://generate?${new URLSearchParams({ videoPath: "/clips/demo.mp4", title })}`;
}

function deferred() {
  let complete!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    complete = resolvePromise;
  });

  return { promise, complete };
}

describe("Path protocol lifecycle", () => {
  it("reports cold status after readiness without creating a generation job", async () => {
    const { protocol } = createProtocol(["pathai://status"]);
    const onStatus = vi.fn();
    const dispatch = vi.fn();

    expect(onStatus).not.toHaveBeenCalled();
    protocol.attach({ onStatus, dispatch, onError: vi.fn() });
    await protocol.shutdown();
    expect(onStatus).toHaveBeenCalledOnce();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("answers status immediately during a pending generation, including status queued at startup", async () => {
    const { app, protocol } = createProtocol([link("First"), "pathai://status"]);
    const first = deferred();
    const onStatus = vi.fn();
    const dispatch = vi.fn(async () => first.promise);

    protocol.attach({ onStatus, dispatch, onError: vi.fn() });
    expect(onStatus).toHaveBeenCalledOnce();
    app.emit("second-instance", {}, ["pathai://status"]);
    app.emit("open-url", { preventDefault: vi.fn() }, "pathai://status/");
    expect(onStatus).toHaveBeenCalledTimes(3);
    expect(dispatch).toHaveBeenCalledOnce();
    first.complete();
    await protocol.shutdown();
    app.emit("second-instance", {}, ["pathai://status"]);
    expect(onStatus).toHaveBeenCalledTimes(3);
  });

  it("registers development with the absolute app directory, not a link or arbitrary argv entry", () => {
    const { app, protocol } = createProtocol(["electron.exe", link("A")]);

    expect(protocol.register()).toBe(true);
    expect(app.setAsDefaultProtocolClient).toHaveBeenCalledWith("pathai", "electron.exe", [
      resolve("apps/desktop"),
    ]);
  });

  it("registers packaged applications using their own executable", () => {
    const { app, protocol } = createProtocol([], true);

    protocol.register();
    expect(app.setAsDefaultProtocolClient).toHaveBeenCalledWith("pathai");
  });

  it("preserves cold argv, early open-url and multiple early second-instance requests in order", async () => {
    const { app, protocol } = createProtocol(["electron.exe", "app", link("Cold")]);
    const preventDefault = vi.fn();
    const dispatch = vi.fn();

    app.emit("open-url", { preventDefault }, link("Mac"));
    app.emit("second-instance", {}, ["electron.exe", link("Warm 1")]);
    app.emit("second-instance", {}, ["electron.exe", link("Warm 2")]);
    expect(dispatch).not.toHaveBeenCalled();
    protocol.attach({ onStatus: vi.fn(), dispatch, onError: vi.fn() });
    await protocol.shutdown();

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(dispatch.mock.calls.map(([command]) => command.title)).toEqual([
      "Cold",
      "Mac",
      "Warm 1",
      "Warm 2",
    ]);
  });

  it("dispatches sequentially, catches errors, and continues with later links", async () => {
    const { app, protocol } = createProtocol([link("First")]);
    const first = deferred();
    const completed: string[] = [];
    const failure = new Error("Import failed");
    const dispatch = vi.fn(async (command: PathAppLink) => {
      if (command.route !== "generate") return;
      if (command.title === "First") await first.promise;
      if (command.title === "Fail") throw failure;

      completed.push(command.title);
    });

    const onError = vi.fn();

    protocol.attach({ onStatus: vi.fn(), dispatch, onError });
    app.emit("second-instance", {}, [link("Fail"), link("Last")]);
    expect(dispatch).toHaveBeenCalledOnce();
    first.complete();
    await protocol.shutdown();
    expect(completed).toEqual(["First", "Last"]);
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it("reports invalid links after readiness without blocking later valid requests", async () => {
    const { app, protocol } = createProtocol(["pathai://unknown"]);
    const dispatch = vi.fn();
    const onError = vi.fn(() => {
      throw new Error("Notification unavailable");
    });

    app.emit("second-instance", {}, [link("Valid")]);
    protocol.attach({ onStatus: vi.fn(), dispatch, onError });
    await protocol.shutdown();
    expect(onError).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ title: "Valid" }));
  });

  it("focuses warm launches immediately while an earlier generation is still running", async () => {
    const { app, protocol } = createProtocol([link("First")]);
    const first = deferred();
    const onLaunch = vi.fn();
    const onError = vi.fn();
    const dispatch = vi.fn(async () => first.promise);

    protocol.attach({ onStatus: vi.fn(), dispatch, onError, onLaunch });
    app.emit("second-instance", {}, ["electron.exe", "app"]);
    app.emit("open-url", { preventDefault: vi.fn() }, "pathai://");
    app.emit("second-instance", {}, ["pathai://unknown"]);
    expect(onLaunch).toHaveBeenCalledTimes(3);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();

    first.complete();
    await protocol.shutdown();
    expect(dispatch).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledOnce();
  });

  it("focuses home for an ordinary second launch and ignores unrelated URL schemes", async () => {
    const { app, protocol } = createProtocol(["electron.exe", "app"]);
    const dispatch = vi.fn();
    const preventDefault = vi.fn();

    protocol.attach({ onStatus: vi.fn(), dispatch, onError: vi.fn() });
    app.emit("open-url", { preventDefault }, "https://example.com");
    expect(preventDefault).not.toHaveBeenCalled();
    app.emit("second-instance", {}, ["electron.exe", "app"]);
    await protocol.shutdown();
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ route: "open" });
  });

  it("stops accepting links at shutdown but waits for all already accepted work", async () => {
    const { app, protocol } = createProtocol([link("First"), link("Queued")]);
    const first = deferred();
    const dispatch = vi.fn(async () => first.promise);

    protocol.attach({ onStatus: vi.fn(), dispatch, onError: vi.fn() });
    const stopped = vi.fn();
    const shutdown = protocol.shutdown().then(stopped);

    app.emit("second-instance", {}, [link("Late")]);
    await Promise.resolve();
    expect(stopped).not.toHaveBeenCalled();
    expect(app.listenerCount("open-url")).toBe(0);
    expect(app.listenerCount("second-instance")).toBe(0);
    first.complete();
    await shutdown;
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(protocol.register()).toBe(false);
  });

  it("can stop a secondary instance before services are attached", async () => {
    const { app, protocol } = createProtocol([link("Unused")]);

    await protocol.shutdown();
    expect(app.listenerCount("open-url")).toBe(0);
    expect(() =>
      protocol.attach({ onStatus: vi.fn(), dispatch: vi.fn(), onError: vi.fn() }),
    ).toThrow();
  });
});
