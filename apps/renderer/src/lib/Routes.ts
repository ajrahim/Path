import { RENDERER_ROUTES } from "@path/shared";

// Next's router.pathname omits trailing slashes, including during static rendering.
const recordingControlPaths = new Set(
  [
    RENDERER_ROUTES.home,
    RENDERER_ROUTES.workspace,
    RENDERER_ROUTES.recorder,
    RENDERER_ROUTES.recordingToolbar,
  ].map((route) => (route === "/" ? route : route.slice(0, -1))),
);

export function routeHasRecordingControls(pathname: string): boolean {
  return recordingControlPaths.has(pathname);
}
