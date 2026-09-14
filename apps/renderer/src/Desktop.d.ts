import type { DesktopApi } from "@path/shared";

declare global {
  interface Window {
    desktop?: DesktopApi;
  }
}

export {};
