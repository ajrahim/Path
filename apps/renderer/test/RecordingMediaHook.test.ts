// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordingStatus } from "@path/shared";
import { useRecordingMedia } from "../src/hooks/useRecordingMedia";

const bridge = vi.hoisted(() => ({ mediaUrl: vi.fn() }));

vi.mock("@/lib/Desktop", () => ({ getDesktopApi: () => ({ recordings: bridge }) }));

const createObjectURL = vi.fn<(blob: Blob) => string>();
const revokeObjectURL = vi.fn<(url: string) => void>();
const fetchMedia = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.resetAllMocks();
  bridge.mediaUrl.mockImplementation(async ({ id }: { id: string }) => `https://media.test/${id}`);
  fetchMedia.mockImplementation(
    async () => new Response("video", { headers: { "Content-Type": "video/mp4" } }),
  );
  createObjectURL.mockReturnValue("blob:recording");
  class MediaURL extends URL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = revokeObjectURL;
  }
  vi.stubGlobal("URL", MediaURL);
  vi.stubGlobal("fetch", fetchMedia);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("recording media lifecycle", () => {
  it("loads once for a recording, retains its URL across title changes, and revokes it on disposal", async () => {
    const { result, rerender, unmount } = renderHook(
      ({ id, status }) => useRecordingMedia(id, status),
      {
        initialProps: { id: "recording-a", status: "ready" as RecordingStatus, title: "Original" },
      },
    );

    await waitFor(() => expect(result.current).toEqual({ status: "ready", url: "blob:recording" }));

    expect(createObjectURL.mock.calls[0][0].type).toBe("video/mp4");

    rerender({ id: "recording-a", status: "ready", title: "Renamed" });

    expect(bridge.mediaUrl).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    unmount();

    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:recording");
    expect(fetchMedia.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("ignores a native URL lookup that resolves after a different recording is selected", async () => {
    const firstLookup = Promise.withResolvers<string>();

    bridge.mediaUrl.mockReturnValueOnce(firstLookup.promise);
    const { result, rerender } = renderHook((id) => useRecordingMedia(id, "ready"), {
      initialProps: "recording-a",
    });

    rerender("recording-b");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(async () => firstLookup.resolve("https://media.test/recording-a"));

    expect(fetchMedia).toHaveBeenCalledTimes(1);
    expect(fetchMedia.mock.calls[0][0]).toBe("https://media.test/recording-b");
    expect(result.current.url).toBe("blob:recording");
  });

  it("does not allocate an object URL when blob decoding finishes after unmount", async () => {
    const decoded = Promise.withResolvers<Blob>();
    const response = new Response("video");
    const decode = vi.spyOn(response, "blob").mockReturnValue(decoded.promise);

    fetchMedia.mockResolvedValue(response);
    const { unmount } = renderHook(() => useRecordingMedia("recording-a", "ready"));

    await waitFor(() => expect(decode).toHaveBeenCalled());
    unmount();

    // Model a decode already in flight when abort was requested; cleanup must still win.
    await act(async () => decoded.resolve(new Blob(["video"])));

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(fetchMedia.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("never reuses a revoked URL when switching away and back before the next load finishes", async () => {
    const pending = Promise.withResolvers<string>();
    const { result, rerender } = renderHook((id) => useRecordingMedia(id, "ready"), {
      initialProps: "recording-a",
    });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    bridge.mediaUrl.mockReturnValue(pending.promise);
    rerender("recording-b");
    rerender("recording-a");

    expect(result.current).toEqual({ status: "loading", url: null });
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:recording");
  });

  it("does not fetch unfinished recordings and reports a failed media request", async () => {
    const { result, rerender } = renderHook(
      (status: RecordingStatus) => useRecordingMedia("recording-a", status),
      { initialProps: "processing" as RecordingStatus },
    );

    expect(result.current).toEqual({ status: "idle", url: null });
    expect(bridge.mediaUrl).not.toHaveBeenCalled();

    fetchMedia.mockResolvedValue(new Response("unavailable", { status: 404 }));
    rerender("ready");
    await waitFor(() => expect(result.current).toEqual({ status: "error", url: null }));

    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
