import { describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "@path/shared";
import { RendererFlush } from "../src/ipc/RendererFlush";

function target(id: number, onSend?: (requestId: number) => void) {
  return {
    id,
    isDestroyed: () => false,
    send: vi.fn((_channel: string, requestId: number) => onSend?.(requestId)),
  };
}

describe("RendererFlush", () => {
  it("waits for each window's acknowledgment of its own request", async () => {
    const flush = new RendererFlush();
    const first = target(1, (requestId) => setTimeout(() => flush.acknowledge(1, requestId), 5));
    const second = target(2, (requestId) => setTimeout(() => flush.acknowledge(2, requestId), 10));

    await expect(flush.flushAll([first, second], 1_000)).resolves.toBe(0);
    expect(first.send).toHaveBeenCalledWith(IPC_CHANNELS.appFlushRequested, expect.any(Number));
  });

  it("ignores acknowledgments from another window and counts windows that time out", async () => {
    const flush = new RendererFlush();
    const silent = target(1, (requestId) => flush.acknowledge(99, requestId));
    const destroyed = { ...target(2), isDestroyed: () => true };

    await expect(flush.flushAll([silent, destroyed], 20)).resolves.toBe(1);
    expect(destroyed.send).not.toHaveBeenCalled();
  });
});
