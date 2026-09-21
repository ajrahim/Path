import { useCallback, useEffect } from "react";
import type { ProjectChangeInput } from "@path/shared";
import { changeProject, refreshProjects } from "../state/ProjectSlice";
import { useRendererDispatch } from "./useRendererDispatch";
import { useRendererSelector } from "./useRendererSelector";

export function useRecordingProjects() {
  const dispatch = useRendererDispatch();
  const snapshot = useRendererSelector((root) => root.projects);
  const refresh = useCallback(() => dispatch(refreshProjects()), [dispatch]);
  const change = useCallback(
    (input: ProjectChangeInput) => dispatch(changeProject(input)).unwrap(),
    [dispatch],
  );

  useEffect(() => {
    const request = refresh();
    const onFocus = () => {
      void refresh();
    };

    window.addEventListener("focus", onFocus);

    return () => {
      request.abort();
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  return { ...snapshot, change, refresh };
}
