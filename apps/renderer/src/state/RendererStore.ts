import { configureStore } from "@reduxjs/toolkit";
import { recordingReducer } from "@/state/RecordingSlice";
import { historyReducer } from "@/state/HistorySlice";
import { projectReducer } from "@/state/ProjectSlice";
import { getDesktopApi } from "@/lib/Desktop";
import type { DesktopDependencies } from "./DesktopDependencies";

/** Builds independent window state with injectable desktop effects for deterministic tests. */
export function createRendererStore(dependencies: DesktopDependencies = { getDesktopApi }) {
  return configureStore({
    reducer: { recording: recordingReducer, history: historyReducer, projects: projectReducer },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({ thunk: { extraArgument: dependencies } }),
  });
}

export type RendererStore = ReturnType<typeof createRendererStore>;

export type RendererState = ReturnType<RendererStore["getState"]>;

export type RendererDispatch = RendererStore["dispatch"];
