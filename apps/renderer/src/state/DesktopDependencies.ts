import type { DesktopApi } from "@path/shared";

/** Keeps thunk effects replaceable without putting the preload bridge into Redux state. */
export interface DesktopDependencies {
  getDesktopApi(): DesktopApi | null;
}

/** Rejection for writes attempted in static rendering or a browser preview. */
export const DESKTOP_UNAVAILABLE_MESSAGE = "The desktop bridge is unavailable";
