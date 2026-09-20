import { screen, type BrowserWindow } from "electron";
import type { RecordingRuntimeState } from "@path/shared";

export class RecordingWindowController {
  private previousStatus: RecordingRuntimeState["status"] = "idle";

  constructor(
    private readonly mainWindow: BrowserWindow,
    private readonly recorderWindow: BrowserWindow,
    private readonly toolbarWindow: BrowserWindow,
  ) {}

  update(state: RecordingRuntimeState): void {
    // Elapsed-time updates must not repeatedly reposition windows or steal focus.
    if (state.status === this.previousStatus) return;
    const previousStatus = this.previousStatus;

    this.previousStatus = state.status;
    const capturing = state.status === "recording" || state.status === "paused";
    const wasCapturing = previousStatus === "recording" || previousStatus === "paused";

    if (capturing && !wasCapturing) {
      this.enterRecordingMode();
    } else if (
      !capturing &&
      wasCapturing &&
      ["stopping", "processing", "ready", "failed"].includes(state.status)
    ) {
      this.leaveRecordingMode();
    }
  }

  restoreMainWindow(force = false): void {
    if (!force && (this.previousStatus === "recording" || this.previousStatus === "paused")) {
      if (!this.mainWindow.isMinimized()) this.mainWindow.minimize();
      if (!this.toolbarWindow.isVisible()) this.toolbarWindow.showInactive();

      return;
    }

    this.toolbarWindow.hide();
    if (this.mainWindow.isMinimized()) this.mainWindow.restore();
    this.mainWindow.show();
    this.mainWindow.focus();
  }

  private enterRecordingMode(): void {
    this.recorderWindow.hide();
    const display = screen.getDisplayMatching(this.mainWindow.getBounds());
    const { width, height } = this.toolbarWindow.getBounds();
    const margin = 16;
    const x = Math.round(display.workArea.x + display.workArea.width - width - margin);
    const y =
      process.platform === "darwin"
        ? Math.round(display.workArea.y + margin)
        : Math.round(display.workArea.y + display.workArea.height - height - margin);

    // Show the toolbar without activating it so keyboard input stays with the recorded application.
    this.toolbarWindow.setPosition(x, y, false);
    this.mainWindow.minimize();
    this.toolbarWindow.showInactive();
  }

  private leaveRecordingMode(): void {
    this.restoreMainWindow(true);
  }
}
