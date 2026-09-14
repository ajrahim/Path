import { Menu, Tray, nativeImage, screen, type BrowserWindow } from "electron";
import messages from "@path/shared/messages/en.json";
import type { RecordingRuntimeStatus } from "@path/shared";

const RECORDER_POPOVER_WIDTH = 400;
const RECORDER_POPOVER_COLLAPSED_HEIGHT = 80;
const RECORDER_POPOVER_EXPANDED_HEIGHT = 230;

function createTrayImage(status: RecordingRuntimeStatus = "idle") {
  const fill =
    status === "recording"
      ? "#d83f36"
      : status === "processing" || status === "stopping"
        ? "#c28227"
        : "#18181b";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><rect x="2" y="2" width="14" height="14" rx="4" fill="${fill}"/><circle cx="9" cy="9" r="3.5" fill="#fafafa"/></svg>`;

  return nativeImage.createFromDataURL(
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
  );
}

export class TrayController {
  private readonly tray: Tray;

  constructor(
    private readonly mainWindow: BrowserWindow,
    private readonly recorderWindow: BrowserWindow,
  ) {
    this.tray = new Tray(createTrayImage());
    this.tray.setToolTip(messages.app.name);
    this.tray.on("click", () => this.toggleRecorderWindow());
    this.tray.on("right-click", () => this.popUpContextMenu());
  }

  popUpContextMenu(): void {
    const menu = Menu.buildFromTemplate([
      { label: messages.tray.openApp, click: () => this.showWindow() },
      { type: "separator" },
      { label: messages.tray.quit, role: "quit" },
    ]);

    this.tray.popUpContextMenu(menu);
  }

  destroy(): void {
    this.tray.destroy();
  }

  setRecordingState(status: RecordingRuntimeStatus): void {
    this.tray.setImage(createTrayImage(status));
  }

  showMainWindow(): void {
    this.showWindow();
    this.recorderWindow.hide();
  }

  setRecorderPopoverExpanded(expanded: boolean): void {
    const bounds = this.recorderWindow.getBounds();
    const height = expanded ? RECORDER_POPOVER_EXPANDED_HEIGHT : RECORDER_POPOVER_COLLAPSED_HEIGHT;

    if (bounds.width === RECORDER_POPOVER_WIDTH && bounds.height === height) {
      return;
    }

    // On Windows, expanding upward keeps the popover anchored to the bottom tray edge.
    this.recorderWindow.setBounds(
      {
        x: bounds.x,
        y:
          process.platform === "darwin" || !this.recorderWindow.isVisible()
            ? bounds.y
            : bounds.y + bounds.height - height,
        width: RECORDER_POPOVER_WIDTH,
        height,
      },
      false,
    );
  }

  private showWindow(): void {
    this.mainWindow.show();
    this.mainWindow.focus();
  }

  private toggleRecorderWindow(): void {
    if (this.recorderWindow.isVisible()) {
      this.recorderWindow.hide();

      return;
    }

    const trayBounds = this.tray.getBounds();
    const workArea = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y }).workArea;
    const { width, height } = this.recorderWindow.getBounds();

    const x = Math.round(
      Math.min(
        workArea.x + workArea.width - width,
        Math.max(workArea.x, trayBounds.x + trayBounds.width / 2 - width / 2),
      ),
    );

    const y =
      process.platform === "darwin"
        ? Math.round(trayBounds.y + trayBounds.height + 6)
        : Math.round(trayBounds.y - height - 8);

    this.recorderWindow.setPosition(x, y, false);
    this.recorderWindow.show();
    this.recorderWindow.focus();
  }
}
