import { asc, eq, sql } from "drizzle-orm";
import type { PathDatabase } from "./Connection";
import { assetDeletions } from "./Schema";

export interface PendingAssetDeletion {
  path: string;
  isDirectory: boolean;
  attemptCount: number;
}

/** Deletion intents written alongside row deletions; the desktop removes the files. */
export class AssetDeletionRepository {
  constructor(private readonly db: PathDatabase) {}

  listPending(limit: number): PendingAssetDeletion[] {
    return (
      this.db
        .select({
          path: assetDeletions.path,
          isDirectory: assetDeletions.isDirectory,
          attemptCount: assetDeletions.attemptCount,
        })
        .from(assetDeletions)
        // Entries that keep failing, such as a locked file, must not starve newer deletions.
        .orderBy(asc(assetDeletions.attemptCount), asc(assetDeletions.requestedAt))
        .limit(limit)
        .all()
    );
  }

  complete(path: string): void {
    this.db.delete(assetDeletions).where(eq(assetDeletions.path, path)).run();
  }

  recordFailedAttempt(path: string): void {
    this.db
      .update(assetDeletions)
      .set({ attemptCount: sql`${assetDeletions.attemptCount} + 1` })
      .where(eq(assetDeletions.path, path))
      .run();
  }
}
