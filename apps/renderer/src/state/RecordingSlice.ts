import { createAsyncThunk, createSlice, isAnyOf } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import type { CaptureSource, RecordingRuntimeState, StartRecordingInput } from "@path/shared";
import type { DesktopDependencies } from "@/state/DesktopDependencies";

// Request IDs distinguish concurrent commands; revisions reject replies older than pushed state.
interface RecordingState {
  runtime: RecordingRuntimeState;
  sources: CaptureSource[];
  sourceError: string | null;
  sourceRequestId: string | null;
  commandRequestId: string | null;
  commandRevision: number;
  connectionId: string | null;
  revision: number;
}

interface RuntimeReply {
  runtime: RecordingRuntimeState;
  connectionId: string | null;
  revision: number;
}

type RecordingThunk = {
  state: { recording: RecordingState };
  extra: DesktopDependencies;
  rejectValue: string;
};

const initialState: RecordingState = {
  runtime: { status: "idle", recordingId: null, elapsedMs: 0, captureClicks: false, error: null },
  sources: [],
  sourceError: null,
  sourceRequestId: null,
  commandRequestId: null,
  commandRevision: 0,
  connectionId: null,
  revision: 0,
};

export const loadCaptureSources = createAsyncThunk<CaptureSource[], void, RecordingThunk>(
  "recording/loadSources",
  async (_, { extra, rejectWithValue }) => {
    try {
      return (await extra.getDesktopApi()?.recording.listSources()) ?? [];
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : "Unable to list capture sources",
      );
    }
  },
);

export const startRecording = createAsyncThunk<RuntimeReply, StartRecordingInput, RecordingThunk>(
  "recording/start",
  async (input, { extra, getState, rejectWithValue }) => {
    const desktop = extra.getDesktopApi();

    if (!desktop) return rejectWithValue("The desktop bridge is unavailable");

    const { connectionId, revision } = getState().recording;

    try {
      return { runtime: await desktop.recording.start(input), connectionId, revision };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Recording preparation failed";

      try {
        const runtime = await desktop.recording.getState();

        return { runtime: { ...runtime, error: message }, connectionId, revision };
      } catch {
        // Keep the last authoritative state when both preparation and recovery fail.
        return rejectWithValue(message);
      }
    }
  },
  { condition: (_, { getState }) => getState().recording.commandRequestId === null },
);

export const stopRecording = createAsyncThunk<RuntimeReply, void, RecordingThunk>(
  "recording/stop",
  async (_, { extra, getState, rejectWithValue }) => {
    const desktop = extra.getDesktopApi();

    if (!desktop) return rejectWithValue("The desktop bridge is unavailable");

    const { connectionId, revision } = getState().recording;

    try {
      return { runtime: await desktop.recording.stop(), connectionId, revision };
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : "Unable to stop recording");
    }
  },
  { condition: (_, { getState }) => getState().recording.commandRequestId === null },
);

export const pauseRecording = createAsyncThunk<RuntimeReply, void, RecordingThunk>(
  "recording/pause",
  async (_, { extra, getState, rejectWithValue }) => {
    const desktop = extra.getDesktopApi();

    if (!desktop) return rejectWithValue("The desktop bridge is unavailable");

    const { connectionId, revision } = getState().recording;

    try {
      return { runtime: await desktop.recording.pause(), connectionId, revision };
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : "Unable to pause recording");
    }
  },
  { condition: (_, { getState }) => getState().recording.commandRequestId === null },
);

export const resumeRecording = createAsyncThunk<RuntimeReply, void, RecordingThunk>(
  "recording/resume",
  async (_, { extra, getState, rejectWithValue }) => {
    const desktop = extra.getDesktopApi();

    if (!desktop) return rejectWithValue("The desktop bridge is unavailable");

    const { connectionId, revision } = getState().recording;

    try {
      return { runtime: await desktop.recording.resume(), connectionId, revision };
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : "Unable to resume recording");
    }
  },
  { condition: (_, { getState }) => getState().recording.commandRequestId === null },
);

export const setRecordingClickTracking = createAsyncThunk<RuntimeReply, boolean, RecordingThunk>(
  "recording/setClickTracking",
  async (enabled, { extra, getState, rejectWithValue }) => {
    const desktop = extra.getDesktopApi();

    if (!desktop) return rejectWithValue("The desktop bridge is unavailable");

    const { connectionId, revision } = getState().recording;

    try {
      return { runtime: await desktop.recording.setClickTracking(enabled), connectionId, revision };
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : "Unable to toggle click tracking",
      );
    }
  },
  { condition: (_, { getState }) => getState().recording.commandRequestId === null },
);

// The desktop remains authoritative; the slice reconciles its events, reads, and command replies.
const recordingSlice = createSlice({
  name: "recording",
  initialState,
  reducers: {
    connectionOpened(state, action: PayloadAction<string>) {
      state.connectionId = action.payload;
      state.commandRequestId = null;
    },
    connectionClosed(state, action: PayloadAction<string>) {
      if (state.connectionId !== action.payload) return;

      state.connectionId = null;
      state.commandRequestId = null;
    },
    runtimeReceived(state, action: PayloadAction<RuntimeReply>) {
      if (state.connectionId !== action.payload.connectionId) return;

      if (state.revision !== action.payload.revision) return;

      state.runtime = action.payload.runtime;
      state.revision += 1;
    },
    runtimeReadFailed(
      state,
      action: PayloadAction<{ connectionId: string; revision: number; error: string }>,
    ) {
      if (
        state.connectionId !== action.payload.connectionId ||
        state.revision !== action.payload.revision
      ) {
        return;
      }

      state.runtime.error = action.payload.error;
    },
  },
  extraReducers(builder) {
    builder
      .addCase(loadCaptureSources.pending, (state, action) => {
        state.sourceRequestId = action.meta.requestId;
        state.sourceError = null;
      })
      .addCase(loadCaptureSources.fulfilled, (state, action) => {
        if (state.sourceRequestId !== action.meta.requestId) return;

        state.sources = action.payload;
        state.sourceRequestId = null;
      })
      .addCase(loadCaptureSources.rejected, (state, action) => {
        if (state.sourceRequestId !== action.meta.requestId) return;

        state.sourceRequestId = null;
        if (!action.meta.aborted) {
          state.sourceError = action.payload ?? "Unable to list capture sources";
        }
      })
      .addMatcher(
        isAnyOf(
          startRecording.pending,
          stopRecording.pending,
          pauseRecording.pending,
          resumeRecording.pending,
          setRecordingClickTracking.pending,
        ),
        (state, action) => {
          state.commandRequestId = action.meta.requestId;
          state.commandRevision = state.revision;
        },
      )
      .addMatcher(
        isAnyOf(
          startRecording.fulfilled,
          stopRecording.fulfilled,
          pauseRecording.fulfilled,
          resumeRecording.fulfilled,
          setRecordingClickTracking.fulfilled,
        ),
        (state, action) => {
          if (state.commandRequestId !== action.meta.requestId) return;

          state.commandRequestId = null;
          // A pushed event supersedes an older command response, just as it supersedes a poll.
          if (
            state.connectionId !== action.payload.connectionId ||
            state.revision !== action.payload.revision
          ) {
            return;
          }

          state.runtime = action.payload.runtime;
          state.revision += 1;
        },
      )
      .addMatcher(
        isAnyOf(
          startRecording.rejected,
          stopRecording.rejected,
          pauseRecording.rejected,
          resumeRecording.rejected,
          setRecordingClickTracking.rejected,
        ),
        (state, action) => {
          if (state.commandRequestId !== action.meta.requestId) return;

          state.commandRequestId = null;
          if (!action.meta.aborted && state.commandRevision === state.revision) {
            state.runtime.error = action.payload ?? "Unable to update recording state";
          }
        },
      );
  },
});

export const { connectionOpened, connectionClosed, runtimeReceived, runtimeReadFailed } =
  recordingSlice.actions;
export const recordingReducer = recordingSlice.reducer;
