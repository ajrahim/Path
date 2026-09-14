import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrayController } from "../src/tray/TrayController";

const trayHandlers = new Map<string, () => void>();

vi.mock("electron", () => ({
  Menu: { buildFromTemplate: vi.fn() },
  Tray: vi.fn(function () {
    return {
      destroy: vi.fn(),
      getBounds: vi.fn(() => ({ x: 0, y: 0, width: 18, height: 18 })),
      on: vi.fn((event: string, handler: () => void) => {
        trayHandlers.set(event, handler);
      }),
      popUpContextMenu: vi.fn(),
      setImage: vi.fn(),
      setToolTip: vi.fn(),
    };
  }),
  nativeImage: { createFromDataURL: vi.fn(() => ({})) },
  screen: {
    getDisplayNearestPoint: vi.fn(() => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } })),
  },
}));

describe("TrayController recorder popover sizing", () => {
  beforeEach(() => trayHandlers.clear());

  it("keeps the visible popover anchored to the bottom edge while resizing", () => {
    const mainWindow = { focus: vi.fn(), show: vi.fn() };
    const recorderWindow = {
      getBounds: vi.fn(() => ({ x: 100, y: 700, width: 400, height: 80 })),
      hide: vi.fn(),
      isVisible: vi.fn(() => true),
      setBounds: vi.fn(),
    };

    const controller = new TrayController(mainWindow as never, recorderWindow as never);

    controller.setRecorderPopoverExpanded(true);

    // Windows keeps the original bottom edge at 780 while macOS keeps the top edge.
    expect(recorderWindow.setBounds).toHaveBeenCalledWith(
      { x: 100, y: process.platform === "darwin" ? 700 : 550, width: 400, height: 230 },
      false,
    );
  });
});
