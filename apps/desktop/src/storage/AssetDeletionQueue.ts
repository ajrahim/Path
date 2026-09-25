import type { RemoteRepositories } from "./DatabaseClient";
import type { Diagnostics } from "./DiagnosticLog";
import { UnmanagedAssetPathError, type ManagedRecordingAssets } from "./ManagedRecordingAssets";

const DELETIONS_PER_RUN = 100;

/**
 * Removes files whose database rows are already gone. Intents are written in the same
 * transaction as the row deletion, so a failure here (for example a video still locked by a
 * player on Windows) leaves the intent queued for the next run instead of orphaning the file.
 */
export class AssetDeletionQueue {
  private running: Promise<void> | null = null;
  private isRerunRequested = false;

  constructor(
    private readonly deletions: RemoteRepositories["assetDeletions"],
    private readonly assets: Pick<ManagedRecordingAssets, "remove">,
    private readonly diagnostics: Diagnostics,
  ) {}

  /** Runs one pass; a request during a pass schedules exactly one more. */
  process(): Promise<void> {
    if (this.running) {
      this.isRerunRequested = true;

      return this.running;
    }

    this.running = this.removePending().finally(() => {
      this.running = null;

      if (this.isRerunRequested) {
        this.isRerunRequested = false;
        void this.process();
      }
    });

    return this.running;
  }

  private async removePending(): Promise<void> {
    for (const entry of await this.deletions.listPending(DELETIONS_PER_RUN)) {
      try {
        await this.assets.remove(entry.path, entry.isDirectory);
        await this.deletions.complete(entry.path);
      } catch (error) {
        if (error instanceof UnmanagedAssetPathError) {
          // Never delete outside the managed roots; drop the intent and keep the file.
          this.diagnostics.error("Refused an asset deletion outside the managed roots", error);
          await this.deletions.complete(entry.path);
          continue;
        }

        this.diagnostics.warn("Asset deletion will be retried", error);
        await this.deletions.recordFailedAttempt(entry.path);
      }
    }
  }
}
