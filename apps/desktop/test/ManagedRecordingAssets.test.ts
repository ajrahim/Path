import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ManagedRecordingAssets,
  UnmanagedAssetPathError,
} from "../src/storage/ManagedRecordingAssets";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

async function createAssets() {
  const base = mkdtempSync(join(tmpdir(), "path-assets-"));

  directories.push(base);

  const previous = { id: "previous", path: join(base, "previous") };
  const current = { id: "current", path: join(base, "current") };
  const assets = new ManagedRecordingAssets();

  await assets.useRoots(current, [previous]);

  return { assets, base, previous, current };
}

function touch(path: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "data");

  return path;
}

describe("ManagedRecordingAssets", () => {
  it("keeps each recording's files in its own root, including earlier roots", async () => {
    const { assets, previous, current } = await createAssets();
    const recordingId = randomUUID();
    const oldLocation = { recordingId, storageRootPath: previous.path };

    expect(assets.currentRoot).toEqual({ id: "current", path: current.path });
    expect(assets.finalVideoPath(oldLocation)).toBe(
      join(previous.path, recordingId, "recording.mp4"),
    );
    expect(assets.isManagedFile(assets.thumbnailPath(oldLocation))).toBe(true);
  });

  it("refuses paths that escape a root or use an unregistered root", async () => {
    const { assets, base } = await createAssets();

    expect(() =>
      assets.videoPath({ recordingId: "../outside", storageRootPath: join(base, "current") }),
    ).toThrow("escaped");
    expect(() =>
      assets.videoPath({ recordingId: randomUUID(), storageRootPath: join(base, "unknown") }),
    ).toThrow("escaped");
    expect(assets.isManagedFile(join(base, "outside.txt"))).toBe(false);
    expect(assets.isManagedFile("relative/path.png")).toBe(false);
  });

  it("removes only whole recording directories and managed files", async () => {
    const { assets, base, current } = await createAssets();
    const recordingDirectory = join(current.path, randomUUID());
    const screenshot = touch(join(recordingDirectory, "screenshots", "click.png"));
    const outside = touch(join(base, "outside", "keep.txt"));

    await assets.remove(screenshot, false);
    expect(existsSync(screenshot)).toBe(false);
    await expect(assets.remove(screenshot, false)).resolves.toBeUndefined();

    for (const directory of [
      current.path,
      join(recordingDirectory, "screenshots"),
      dirname(outside),
    ]) {
      await expect(assets.remove(directory, true)).rejects.toBeInstanceOf(UnmanagedAssetPathError);
    }

    await expect(assets.remove(outside, false)).rejects.toBeInstanceOf(UnmanagedAssetPathError);
    expect(existsSync(outside)).toBe(true);

    await assets.remove(recordingDirectory, true);
    expect(existsSync(recordingDirectory)).toBe(false);
    expect(existsSync(current.path)).toBe(true);
  });
});
