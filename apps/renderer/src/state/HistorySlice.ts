import { createAsyncThunk, createSlice, isAnyOf } from "@reduxjs/toolkit";
import type { RecordingSummary } from "@path/shared";
import { DESKTOP_UNAVAILABLE_MESSAGE, type DesktopDependencies } from "@/state/DesktopDependencies";
import { getErrorMessage } from "@/lib/ErrorMessage";

// List reads and per-recording writes have separate ownership so unrelated rows can still update.
interface HistoryState {
  status: "idle" | "loading" | "ready" | "error";
  recordings: RecordingSummary[];
  listRequestId: string | null;
  mutationRequestIds: Record<string, string>;
}

type HistoryThunk = {
  state: { history: HistoryState };
  extra: DesktopDependencies;
  rejectValue: string;
};

const initialState: HistoryState = {
  status: "idle",
  recordings: [],
  listRequestId: null,
  mutationRequestIds: {},
};

export const refreshHistory = createAsyncThunk<RecordingSummary[], void, HistoryThunk>(
  "history/refresh",
  async (_, { extra, rejectWithValue }) => {
    try {
      return (await extra.getDesktopApi()?.recordings.list()) ?? [];
    } catch (error) {
      return rejectWithValue(getErrorMessage(error, "Unable to load recordings"));
    }
  },
);

export const renameHistoryRecording = createAsyncThunk<
  RecordingSummary,
  { id: string; title: string },
  HistoryThunk
>(
  "history/rename",
  async (input, { extra, rejectWithValue }) => {
    const desktop = extra.getDesktopApi();

    if (!desktop) return rejectWithValue(DESKTOP_UNAVAILABLE_MESSAGE);

    try {
      return await desktop.recordings.rename(input);
    } catch (error) {
      return rejectWithValue(getErrorMessage(error, "Unable to rename recording"));
    }
  },
  { condition: ({ id }, { getState }) => !getState().history.mutationRequestIds[id] },
);

export const deleteHistoryRecording = createAsyncThunk<void, { id: string }, HistoryThunk>(
  "history/delete",
  async (input, { extra, rejectWithValue }) => {
    const desktop = extra.getDesktopApi();

    if (!desktop) return rejectWithValue(DESKTOP_UNAVAILABLE_MESSAGE);

    try {
      await desktop.recordings.delete(input);
    } catch (error) {
      return rejectWithValue(getErrorMessage(error, "Unable to delete recording"));
    }
  },
  { condition: ({ id }, { getState }) => !getState().history.mutationRequestIds[id] },
);

const historySlice = createSlice({
  name: "history",
  initialState,
  reducers: {},
  extraReducers(builder) {
    builder
      .addCase(refreshHistory.pending, (state, action) => {
        state.listRequestId = action.meta.requestId;
        state.status = "loading";
      })
      .addCase(refreshHistory.fulfilled, (state, action) => {
        if (state.listRequestId !== action.meta.requestId) return;

        state.recordings = action.payload;
        state.status = "ready";
        state.listRequestId = null;
      })
      .addCase(refreshHistory.rejected, (state, action) => {
        if (state.listRequestId !== action.meta.requestId) return;

        state.status = action.meta.aborted ? "idle" : "error";
        state.listRequestId = null;
      })
      .addCase(renameHistoryRecording.fulfilled, (state, action) => {
        const index = state.recordings.findIndex((recording) => recording.id === action.payload.id);

        if (index >= 0) state.recordings[index] = action.payload;
      })
      .addCase(deleteHistoryRecording.fulfilled, (state, action) => {
        state.recordings = state.recordings.filter(
          (recording) => recording.id !== action.meta.arg.id,
        );
      })
      .addMatcher(
        isAnyOf(renameHistoryRecording.pending, deleteHistoryRecording.pending),
        (state, action) => {
          state.mutationRequestIds[action.meta.arg.id] = action.meta.requestId;
        },
      )
      .addMatcher(
        isAnyOf(renameHistoryRecording.fulfilled, deleteHistoryRecording.fulfilled),
        (state, action) => {
          delete state.mutationRequestIds[action.meta.arg.id];
          // Reads started before a successful mutation cannot restore its old title or deleted row.
          state.listRequestId = null;
          state.status = "ready";
        },
      )
      .addMatcher(
        isAnyOf(renameHistoryRecording.rejected, deleteHistoryRecording.rejected),
        (state, action) => {
          if (state.mutationRequestIds[action.meta.arg.id] === action.meta.requestId) {
            delete state.mutationRequestIds[action.meta.arg.id];
          }
        },
      );
  },
});

export const historyReducer = historySlice.reducer;
