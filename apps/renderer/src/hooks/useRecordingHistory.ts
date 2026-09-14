import { useCallback } from "react";
import { useRendererDispatch } from "./useRendererDispatch";
import { useRendererSelector } from "./useRendererSelector";
import {
  deleteHistoryRecording,
  refreshHistory,
  renameHistoryRecording,
} from "../state/HistorySlice";

/** Coordinates history mutations with the follow-up refresh needed by every mounted consumer. */
export function useRecordingHistory() {
  const dispatch = useRendererDispatch();
  const snapshot = useRendererSelector((root) => root.history);
  const refresh = useCallback(() => dispatch(refreshHistory()), [dispatch]);
  const rename = useCallback(
    async (id: string, title: string) => {
      await dispatch(renameHistoryRecording({ id, title })).unwrap();
      // Include unrelated recordings completed while the mutation invalidated an older list.
      await dispatch(refreshHistory());
    },
    [dispatch],
  );

  const remove = useCallback(
    async (id: string) => {
      await dispatch(deleteHistoryRecording({ id })).unwrap();
      await dispatch(refreshHistory());
    },
    [dispatch],
  );

  return { snapshot, refresh, rename, remove };
}
