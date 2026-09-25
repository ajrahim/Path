import { IPC_CHANNELS } from "@path/shared";

interface FlushTarget {
  id: number;
  isDestroyed(): boolean;
  send(channel: string, ...args: unknown[]): void;
}

interface PendingFlush {
  senderId: number;
  finish(): void;
}

/**
 * Before quitting, asks every renderer to finish work that must be durable, such as a debounced
 * draft write, and waits for each window's acknowledgment up to a time limit.
 */
export class RendererFlush {
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingFlush>();

  /** Resolves with the number of windows that did not acknowledge in time. */
  async flushAll(targets: FlushTarget[], timeoutMs: number): Promise<number> {
    const results = await Promise.all(
      targets
        .filter((target) => !target.isDestroyed())
        .map((target) => this.flush(target, timeoutMs)),
    );

    return results.filter((acknowledged) => !acknowledged).length;
  }

  /** Only the window that was asked may acknowledge its own request. */
  acknowledge(senderId: number, requestId: number): void {
    const request = this.pending.get(requestId);

    if (request?.senderId !== senderId) return;

    this.pending.delete(requestId);
    request.finish();
  }

  private flush(target: FlushTarget, timeoutMs: number): Promise<boolean> {
    const requestId = this.nextRequestId++;

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve(false);
      }, timeoutMs);

      this.pending.set(requestId, {
        senderId: target.id,
        finish: () => {
          clearTimeout(timer);
          resolve(true);
        },
      });

      target.send(IPC_CHANNELS.appFlushRequested, requestId);
    });
  }
}
