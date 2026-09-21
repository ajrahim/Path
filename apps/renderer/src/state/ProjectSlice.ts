import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import type { ProjectChangeInput, RecordingProject } from "@path/shared";
import type { DesktopDependencies } from "./DesktopDependencies";

interface ProjectState {
  projects: RecordingProject[];
  status: "idle" | "loading" | "ready" | "error";
  saving: boolean;
  requestId: string | null;
}

type ProjectThunk = { state: { projects: ProjectState }; extra: DesktopDependencies };
const initialState: ProjectState = { projects: [], status: "idle", saving: false, requestId: null };

export const refreshProjects = createAsyncThunk<RecordingProject[], void, ProjectThunk>(
  "projects/refresh",
  async (_, { extra }) => (await extra.getDesktopApi()?.projects.list()) ?? [],
  { condition: (_, { getState }) => !getState().projects.saving },
);

export const changeProject = createAsyncThunk<RecordingProject[], ProjectChangeInput, ProjectThunk>(
  "projects/change",
  async (input, { extra }) => {
    const desktop = extra.getDesktopApi();

    if (!desktop) throw new Error("The desktop bridge is unavailable");

    return desktop.projects.change(input);
  },
  { condition: (_, { getState }) => !getState().projects.saving },
);

const projectSlice = createSlice({
  name: "projects",
  initialState,
  reducers: {},
  extraReducers(builder) {
    builder
      .addCase(refreshProjects.pending, (state, action) => {
        state.requestId = action.meta.requestId;
        if (state.status !== "ready") state.status = "loading";
      })
      .addCase(refreshProjects.fulfilled, (state, action) => {
        if (state.requestId !== action.meta.requestId) return;
        state.projects = action.payload;
        state.status = "ready";
        state.requestId = null;
      })
      .addCase(refreshProjects.rejected, (state, action) => {
        if (state.requestId !== action.meta.requestId) return;
        state.status = action.meta.aborted ? "idle" : "error";
        state.requestId = null;
      })
      .addCase(changeProject.pending, (state) => {
        state.saving = true;
        state.status = "ready";
        state.requestId = null;
      })
      .addCase(changeProject.fulfilled, (state, action) => {
        state.projects = action.payload;
        state.status = "ready";
        state.saving = false;
      })
      .addCase(changeProject.rejected, (state) => {
        state.saving = false;
      });
  },
});

export const projectReducer = projectSlice.reducer;
