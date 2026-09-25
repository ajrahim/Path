import { mkdir, rm, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { RecordingAssetLocation, StorageRoot } from "@path/database";

// Recording directories are named by their UUID; nothing else under a root is ever removed.
const RECORDING_DIRECTORY_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A queued deletion that points outside the managed roots; it is refused, never retried. */
export class UnmanagedAssetPathError extends Error {
  constructor(kind: "file" | "directory") {
    super(`Refusing to delete a ${kind} outside the managed recording roots`);
    this.name = "UnmanagedAssetPathError";
  }
}

/**
 * Owns recording asset paths inside registered storage roots. Each recording keeps its files in
 * `<its storage root>/<recording id>/`, so recordings made before a location change stay usable.
 */
export class ManagedRecordingAssets {
  private current: StorageRoot | null = null;
  private readonly allowedRoots = new Set<string>();

  /** The root new recordings are created in; set once settings are loaded. */
  get currentRoot(): StorageRoot {
    if (!this.current) throw new Error("The recording location has not been initialized");

    return this.current;
  }

  /** Registers every known root and makes one of them current, creating it if needed. */
  async useRoots(current: StorageRoot, registered: StorageRoot[]): Promise<void> {
    this.registerRoots(registered);

    await mkdir(current.path, { recursive: true });
    this.allowedRoots.add(resolve(current.path));
    this.current = { id: current.id, path: resolve(current.path) };
  }

  /** Registers existing assets without creating or selecting a recording destination. */
  registerRoots(roots: StorageRoot[]): void {
    for (const root of roots) this.allowedRoots.add(resolve(root.path));
  }

  recordingDirectory(location: RecordingAssetLocation): string {
    const root = resolve(location.storageRootPath);
    const directory = resolve(root, location.recordingId);

    if (!this.allowedRoots.has(root) || dirname(directory) !== root) {
      throw new Error("Recording asset path escaped the managed directory");
    }

    return directory;
  }

  async createRecordingDirectory(location: RecordingAssetLocation): Promise<string> {
    const directory = this.recordingDirectory(location);

    await mkdir(directory, { recursive: false });

    return directory;
  }

  videoPath(location: RecordingAssetLocation): string {
    return join(this.recordingDirectory(location), "recording.webm");
  }

  finalVideoPath(location: RecordingAssetLocation): string {
    return join(this.recordingDirectory(location), "recording.mp4");
  }

  audioPath(location: RecordingAssetLocation): string {
    return join(this.recordingDirectory(location), "audio.wav");
  }

  thumbnailPath(location: RecordingAssetLocation): string {
    return join(this.recordingDirectory(location), "thumbnail.png");
  }

  async clickScreenshotPath(location: RecordingAssetLocation, clickId: string): Promise<string> {
    const directory = join(this.recordingDirectory(location), "screenshots");

    await mkdir(directory, { recursive: true });

    return join(directory, `click-${clickId}.png`);
  }

  isManagedFile(filePath: string): boolean {
    if (!isAbsolute(filePath)) return false;

    return [...this.allowedRoots].some((root) => {
      const pathFromRoot = relative(root, resolve(filePath));

      return pathFromRoot !== "" && !pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot);
    });
  }

  /**
   * Removes a queued asset. A directory must be exactly `<registered root>/<recording id>`; a file
   * must sit inside a registered root. Anything else is refused and never touched.
   */
  async remove(path: string, isDirectory: boolean): Promise<void> {
    const target = resolve(path);

    if (isDirectory) {
      const isRecordingDirectory =
        this.allowedRoots.has(dirname(target)) && RECORDING_DIRECTORY_NAME.test(basename(target));

      if (!isRecordingDirectory) throw new UnmanagedAssetPathError("directory");

      await rm(target, { recursive: true, force: true });

      return;
    }

    if (!this.isManagedFile(target)) throw new UnmanagedAssetPathError("file");

    try {
      await unlink(target);
    } catch (error) {
      // A previously removed file already satisfies deletion; other failures require attention.
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
        throw error;
      }
    }
  }
}
