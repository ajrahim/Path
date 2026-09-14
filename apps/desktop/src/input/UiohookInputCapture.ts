import { uIOhook, type UiohookMouseEvent } from "uiohook-napi";
import type { MouseButton } from "@path/shared";
import type { GlobalInputCapture, GlobalMouseDownEvent } from "./GlobalInputCapture";

function mouseButton(value: unknown): MouseButton | null {
  if (value === 1) return "left";
  if (value === 2) return "right";
  if (value === 3) return "middle";

  return null;
}

export class UiohookInputCapture implements GlobalInputCapture {
  private handler: ((event: UiohookMouseEvent) => void) | null = null;

  async start(listener: (event: GlobalMouseDownEvent) => void): Promise<void> {
    if (this.handler) return;
    this.handler = (event) => {
      const button = mouseButton(event.button);

      if (button) listener({ x: event.x, y: event.y, button });
    };

    uIOhook.on("mousedown", this.handler);
    uIOhook.start();
  }

  async stop(): Promise<void> {
    if (!this.handler) return;

    // Release this subscription before stopping the shared native event source.
    uIOhook.removeListener("mousedown", this.handler);
    this.handler = null;
    uIOhook.stop();
  }
}
