import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FfmpegMediaProcessor } from "../src/media/FfmpegMediaProcessor";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

function mockFfmpeg(output: string, code = 0) {
  const child = Object.assign(new EventEmitter(), { stderr: new PassThrough(), kill: vi.fn() });

  vi.mocked(spawn).mockReturnValue(child as never);
  queueMicrotask(() => {
    child.stderr.write(output);
    child.emit("close", code);
  });
}

afterEach(() => {
  vi.resetAllMocks();
  vi.useRealTimers();
});

describe("FfmpegMediaProcessor video inspection", () => {
  it("reads duration, optional audio, and embedded creation time from local media", async () => {
    mockFfmpeg(`Input #0, mov,mp4, from 'video.mp4':
  Metadata:
    creation_time   : 2026-09-01T12:00:00.000000Z
  Duration: 01:02:03.45, start: 0.000000, bitrate: 512 kb/s
  Stream #0:0[0x1](und): Video: h264, yuv420p
  Stream #0:1[0x2](und): Audio: aac, 48000 Hz, stereo
`);

    await expect(new FfmpegMediaProcessor("ffmpeg").probe("video.mp4")).resolves.toEqual({
      durationMs: 3_723_450,
      hasAudio: true,
      createdAt: "2026-09-01T12:00:00.000Z",
    });
    expect(spawn).toHaveBeenCalledWith(
      "ffmpeg",
      expect.arrayContaining(["-protocol_whitelist", "file,pipe", "-frames:v", "1"]),
      { windowsHide: true },
    );
  });

  it("accepts video with no audio or creation metadata", async () => {
    mockFfmpeg("Duration: 00:00:04.10\nStream #0:0: Video: vp9\n");

    await expect(new FfmpegMediaProcessor("ffmpeg").probe("silent.webm")).resolves.toEqual({
      durationMs: 4_100,
      hasAudio: false,
      createdAt: null,
    });
  });

  it.each(["Duration: N/A", "Duration: 00:00:00.00"])(
    "rejects unusable duration: %s",
    async (duration) => {
      mockFfmpeg(`${duration}\nStream #0:0: Video: vp9`);

      await expect(new FfmpegMediaProcessor("ffmpeg").probe("broken.webm")).rejects.toThrow(
        "no valid duration",
      );
    },
  );

  it("rejects files without a decodable video stream", async () => {
    mockFfmpeg("Stream map '0:v:0' matches no streams", 1);

    await expect(new FfmpegMediaProcessor("ffmpeg").probe("audio.mp3")).rejects.toThrow(
      "matches no streams",
    );
  });

  it("terminates media inspection that exceeds its time limit", async () => {
    vi.useFakeTimers();
    const child = Object.assign(new EventEmitter(), { stderr: new PassThrough(), kill: vi.fn() });

    vi.mocked(spawn).mockReturnValue(child as never);
    const probe = new FfmpegMediaProcessor("ffmpeg").probe("stalled.mp4");
    const failed = expect(probe).rejects.toThrow("timed out");

    await vi.advanceTimersByTimeAsync(30_000);
    await failed;
    expect(child.kill).toHaveBeenCalledOnce();
  });
});
