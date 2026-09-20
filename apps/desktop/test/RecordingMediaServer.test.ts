import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RecordingRepository } from "@path/database";
import { RecordingMediaServer } from "../src/media/RecordingMediaServer";
import { ManagedRecordingAssets } from "../src/storage/ManagedRecordingAssets";

let directory: string;
let server: RecordingMediaServer;
let url: string;
let videoPath: string;
let thumbnailPath: string;
let currentRecordingId: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "path-media-test-"));
  const recordingId = randomUUID();

  currentRecordingId = recordingId;
  const assets = new ManagedRecordingAssets(directory);

  await assets.createRecordingDirectory(recordingId);
  videoPath = assets.finalVideoPath(recordingId);
  thumbnailPath = assets.thumbnailPath(recordingId);

  // Distinct bytes verify range handling without depending on video decoding.
  await writeFile(videoPath, "0123456789");
  await writeFile(thumbnailPath, "fake-png-thumbnail");
  const recordings = {
    get: async (id: string) => (id === recordingId ? { videoPath, thumbnailPath } : null),
  } as unknown as RecordingRepository;

  server = new RecordingMediaServer(recordings, assets);
  await server.start();
  url = server.url(recordingId);
});

afterEach(async () => {
  server.close();
  await rm(directory, { recursive: true, force: true });
});

describe("recording media server", () => {
  it("requires its private access token", async () => {
    const response = await fetch(url.split("?")[0]!);

    expect(response.status).toBe(403);
  });

  it("serves byte ranges and suffixes for video seeking", async () => {
    const range = await fetch(url, { headers: { Range: "bytes=2-4" } });

    expect(range.status).toBe(206);
    expect(range.headers.get("content-range")).toBe("bytes 2-4/10");
    expect(await range.text()).toBe("234");

    const suffix = await fetch(url, { headers: { Range: "bytes=-2" } });

    expect(suffix.status).toBe(206);
    expect(await suffix.text()).toBe("89");
  });

  it.each(["bytes=5-2", "bytes=0-9007199254740992", "bytes=10-", "bytes=-0"])(
    "rejects invalid range %s",
    async (range) => {
      const response = await fetch(url, { headers: { Range: range } });

      expect(response.status).toBe(416);
      expect(response.headers.get("content-range")).toBe("bytes */10");
    },
  );

  it("responds to HEAD without sending media bytes", async () => {
    const response = await fetch(url, { method: "HEAD" });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("10");
    expect(await response.text()).toBe("");
  });

  it("rejects methods that do not retrieve media", async () => {
    const response = await fetch(url, { method: "POST" });

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD, OPTIONS");
  });

  it("handles empty media without creating a negative stream range", async () => {
    await writeFile(videoPath, "");
    const response = await fetch(url);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");

    const range = await fetch(url, { headers: { Range: "bytes=-1" } });

    expect(range.status).toBe(416);
  });

  it("serves recording thumbnail image", async () => {
    const thumbnailUrl = server.thumbnailUrl(currentRecordingId);
    const response = await fetch(thumbnailUrl);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(await response.text()).toBe("fake-png-thumbnail");
  });
});
