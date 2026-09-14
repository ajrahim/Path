import type { MouseButton } from "@path/shared";

export interface GlobalMouseDownEvent {
  // Native global coordinates; the recording adapter owns conversion to Electron DIP.
  x: number;
  y: number;
  button: MouseButton;
}

export interface GlobalInputCapture {
  start(listener: (event: GlobalMouseDownEvent) => void): Promise<void>;
  stop(): Promise<void>;
}
