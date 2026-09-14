import { mkdir, rm, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

// Owns recording paths and the registered roots retained across storage-location changes.
export class ManagedRecordingAssets {
  private root: string;
  private readonly allowedRoots = new Set<string>();

  constructor(root: string, previousRoots: string[] = []) {
    this.root = resolve(root);
    this.allowedRoots.add(this.root);

    // Earlier storage locations remain registered so changing the default does not orphan recordings.
    for (const previousRoot of previousRoots) {
      this.allowedRoots.add(resolve(previousRoot));
    }
  }

  async ensureRoot(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  async setRoot(root: string): Promise<void> {
    const nextRoot = resolve(root);

    await mkdir(nextRoot, { recursive: true });
    this.root = nextRoot;
    this.allowedRoots.add(nextRoot);
  }

  addAllowedRoot(root: string): void {
    this.allowedRoots.add(resolve(root));
  }

  recordingDirectory(recordingId: string): string {
    const directory = resolve(this.root, recordingId);

    if (dirname(directory) !== this.root) {
      throw new Error("Recording asset path escaped the managed directory");
    }

    return directory;
  }

  async createRecordingDirectory(recordingId: string): Promise<string> {
    const directory = this.recordingDirectory(recordingId);

    await mkdir(directory, { recursive: false });

    return directory;
  }

  videoPath(recordingId: string): string {
    return join(this.recordingDirectory(recordingId), "recording.webm");
  }

  finalVideoPath(recordingId: string): string {
    return join(this.recordingDirectory(recordingId), "recording.mp4");
  }

  audioPath(recordingId: string): string {
    return join(this.recordingDirectory(recordingId), "audio.wav");
  }

  async clickScreenshotPath(recordingId: string, clickId: string): Promise<string> {
    const directory = join(this.recordingDirectory(recordingId), "screenshots");

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

  async delete(recordingId: string, existingFilePath?: string | null): Promise<void> {
    let directory = this.recordingDirectory(recordingId);

    if (existingFilePath && this.isManagedFile(existingFilePath)) {
      const existingDirectory = dirname(resolve(existingFilePath));

      // Containment alone is insufficient for recursive deletion: the directory must own this recording.
      if (basename(existingDirectory) !== recordingId) {
        throw new Error("Recording asset path did not match the recording");
      }

      directory = existingDirectory;
    }

    await rm(directory, { recursive: true, force: true });
  }

  async deleteFile(filePath: string): Promise<void> {
    if (!this.isManagedFile(filePath)) {
      throw new Error("File is outside the managed recording directories");
    }

    try {
      await unlink(resolve(filePath));
    } catch (error) {
      // A previously removed file already satisfies deletion; other failures require attention.
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
        throw error;
      }
    }
  }
}
