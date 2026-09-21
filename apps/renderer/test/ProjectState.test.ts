import { describe, expect, it, vi } from "vitest";
import type { DesktopApi, RecordingProject } from "@path/shared";
import { changeProject, refreshProjects } from "../src/state/ProjectSlice";
import { createRendererStore } from "../src/state/RendererStore";

describe("Project state", () => {
  it("does not let a stale read undo a completed move or allow overlapping writes", async () => {
    let finishRead!: (value: RecordingProject[]) => void;
    let finishChange!: (value: RecordingProject[]) => void;
    const projects = {
      list: vi.fn(
        () =>
          new Promise<RecordingProject[]>((resolve) => {
            finishRead = resolve;
          }),
      ),
      change: vi.fn(
        () =>
          new Promise<RecordingProject[]>((resolve) => {
            finishChange = resolve;
          }),
      ),
    };

    const store = createRendererStore({
      getDesktopApi: () => ({ projects }) as unknown as DesktopApi,
    });

    const read = store.dispatch(refreshProjects());
    const change = store.dispatch(changeProject({ action: "create", name: "First" }));

    await store.dispatch(changeProject({ action: "create", name: "Duplicate" }));
    await store.dispatch(refreshProjects());
    expect(projects.change).toHaveBeenCalledTimes(1);
    expect(projects.list).toHaveBeenCalledTimes(1);
    const result = [{ id: "project", name: "First", recordingIds: ["recording"] }];

    finishChange(result);
    await change;
    finishRead([]);
    await read;
    expect(store.getState().projects.projects).toEqual(result);
  });

  it("retains existing groups after a failed write and allows a retry", async () => {
    const existing = [{ id: "project", name: "First", recordingIds: [] }];
    const projects = {
      list: vi.fn().mockResolvedValue(existing),
      change: vi
        .fn()
        .mockRejectedValueOnce(new Error("Disk unavailable"))
        .mockResolvedValue(existing),
    };

    const store = createRendererStore({
      getDesktopApi: () => ({ projects }) as unknown as DesktopApi,
    });

    await store.dispatch(refreshProjects());
    await expect(
      store.dispatch(changeProject({ action: "create", name: "Next" })).unwrap(),
    ).rejects.toThrow("Disk unavailable");
    expect(store.getState().projects).toMatchObject({
      projects: existing,
      saving: false,
      status: "ready",
    });
    await store.dispatch(changeProject({ action: "create", name: "Next" })).unwrap();
    expect(projects.change).toHaveBeenCalledTimes(2);
  });
});
