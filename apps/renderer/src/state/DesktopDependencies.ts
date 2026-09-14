import type { DesktopApi } from "@path/shared";

/** Keeps thunk effects replaceable without putting the preload bridge into Redux state. */
export interface DesktopDependencies {
  getDesktopApi(): DesktopApi | null;
}
