import type { DesktopApi } from "@path/shared";

/** Static rendering and browser previews have no Electron preload bridge. */
export function getDesktopApi(): DesktopApi | null {
  return typeof window === "undefined" ? null : (window.desktop ?? null);
}
