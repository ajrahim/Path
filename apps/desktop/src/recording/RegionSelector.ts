import { RENDERER_ROUTES } from "@path/shared";
import { BrowserWindow, screen } from "electron";
import type { CaptureRegion, DesktopApi, RegionSelectionContext } from "@path/shared";
import { join } from "node:path";

interface RendererTarget {
  preloadPath: string;
  rendererUrl?: string;
  rendererDirectory: string;
}

type SelectionInput = Parameters<DesktopApi["recording"]["selectRegion"]>[0];
type RegionRectangle = Parameters<DesktopApi["region"]["confirm"]>[0];

export class RegionSelector {
  private window: BrowserWindow | null = null;
  private context: RegionSelectionContext | null = null;
  private displayOrigin = { x: 0, y: 0 };
  private resolveSelection: ((region: CaptureRegion | null) => void) | null = null;

  constructor(private readonly target: RendererTarget) {}

  async select(input: SelectionInput): Promise<CaptureRegion | null> {
    if (this.window) throw new Error("A region selection is already open");
    const display = screen
      .getAllDisplays()
      .find((candidate) => candidate.id.toString() === input.displayId);

    if (!display) {
      throw new Error("The selected display is no longer available");
    }

    this.context = {
      displayId: display.id.toString(),
      width: display.bounds.width,
      height: display.bounds.height,
      scaleFactor: display.scaleFactor,
    };
    this.displayOrigin = { x: display.bounds.x, y: display.bounds.y };
    this.window = new BrowserWindow({
      ...display.bounds,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      backgroundColor: "#00000000",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: this.target.preloadPath,
      },
    });
    this.window.setAlwaysOnTop(true, "screen-saver");
    this.window.once("ready-to-show", () => this.window?.show());

    // Closing the overlay without confirmation resolves the selection as canceled.
    this.window.on("closed", () => {
      this.window = null;
      this.context = null;
      this.resolveSelection?.(null);
      this.resolveSelection = null;
    });

    if (this.target.rendererUrl) {
      await this.window.loadURL(`${this.target.rendererUrl}${RENDERER_ROUTES.region}`);
    } else {
      await this.window.loadFile(
        join(this.target.rendererDirectory, RENDERER_ROUTES.region, "index.html"),
      );
    }

    return new Promise((resolve) => {
      this.resolveSelection = resolve;
    });
  }

  getContext(senderId: number): RegionSelectionContext {
    this.assertSender(senderId);
    if (!this.context) {
      throw new Error("Region selection context is unavailable");
    }

    return this.context;
  }

  confirm(senderId: number, rectangle: RegionRectangle): void {
    this.assertSender(senderId);
    if (!this.context) {
      throw new Error("Region selection context is unavailable");
    }

    const width = Math.min(rectangle.width, this.context.width - rectangle.x);
    const height = Math.min(rectangle.height, this.context.height - rectangle.y);

    if (width < 24 || height < 24) {
      throw new Error("Capture region is too small");
    }

    const region: CaptureRegion = {
      displayId: this.context.displayId,
      x: this.displayOrigin.x + rectangle.x,
      y: this.displayOrigin.y + rectangle.y,
      width,
      height,
      scaleFactor: this.context.scaleFactor,
    };

    // Clear the callback before destroying the overlay so its closed handler cannot resolve twice.
    const resolve = this.resolveSelection;

    this.resolveSelection = null;
    this.window?.destroy();
    resolve?.(region);
  }

  cancel(senderId: number): void {
    this.assertSender(senderId);
    const resolve = this.resolveSelection;

    this.resolveSelection = null;
    this.window?.destroy();
    resolve?.(null);
  }

  private assertSender(senderId: number): void {
    // Only the currently displayed overlay can confirm or cancel its region.
    if (!this.window || this.window.webContents.id !== senderId) {
      throw new Error("Untrusted region selector sender");
    }
  }
}
