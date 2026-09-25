import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Session } from "electron";
import type { DatabaseClient } from "./DatabaseClient";
import { ManagedRecordingAssets } from "./ManagedRecordingAssets";
import type { UserDataLayout } from "./UserDataDirectory";

const DELETION_BATCH_SIZE = 100;
const DATABASE_CLOSE_TIMEOUT_MS = 10_000;

/** Runs before windows and services start, after the previous process has released its files. */
export class AppDataReset {
  private readonly markerPath: string;

  constructor(
    private readonly layout: UserDataLayout,
    private readonly openDatabase: () => Promise<Pick<DatabaseClient, "repositories" | "close">>,
    private readonly browserSession: Pick<
      Session,
      "clearData" | "clearStorageData" | "clearCache" | "clearCodeCaches" | "clearAuthCache"
    >,
  ) {
    this.markerPath = join(layout.userDataDirectory, ".reset-requested");
  }

  async request(): Promise<void> {
    await writeFile(this.markerPath, "Reset Path on next startup\n", { flush: true });
  }

  async completePending(): Promise<void> {
    if (!existsSync(this.markerPath)) return;

    if (existsSync(this.layout.databasePath)) {
      const database = await this.openDatabase();

      try {
        const { recordings, storageRoots, assetDeletions } = database.repositories;
        const assets = new ManagedRecordingAssets();

        assets.registerRoots(await storageRoots.list());
        for (const recording of await recordings.list()) {
          const location = await recordings.getAssetLocation(recording.id);

          if (!location) throw new Error("A recording's storage location could not be found");

          await assets.remove(assets.recordingDirectory(location), true);
        }

        // Deleted rows may still have managed files waiting for removal.
        for (;;) {
          const pending = await assetDeletions.listPending(DELETION_BATCH_SIZE);

          if (pending.length === 0) break;
          for (const asset of pending) {
            await assets.remove(asset.path, asset.isDirectory);
            await assetDeletions.complete(asset.path);
          }
        }
      } finally {
        await database.close(DATABASE_CLOSE_TIMEOUT_MS);
      }
    }

    await this.browserSession.clearData();
    // Chromium's browsing-data removal skips localStorage on our custom path:// origin.
    await this.browserSession.clearStorageData();
    await this.browserSession.clearCache();
    await this.browserSession.clearCodeCaches({});
    await this.browserSession.clearAuthCache();

    // Never delete the profile itself or a user-selected storage root. Only Path owns these paths.
    for (const name of ["recordings", "credentials", "models", "logs", "cli-work", "backups"]) {
      await this.removeProfileEntry(name, true);
    }

    // Keep the database and marker until all asset deletion succeeds, so a failed reset can retry.
    for (const name of ["database.sqlite-wal", "database.sqlite-shm", "database.sqlite"]) {
      await this.removeProfileEntry(name, false);
    }

    await rm(this.markerPath);
  }

  private async removeProfileEntry(name: string, recursive: boolean): Promise<void> {
    const profile = resolve(this.layout.userDataDirectory);
    const target = resolve(profile, name);

    if (dirname(target) !== profile) throw new Error("Reset path escaped the Path profile");

    await rm(target, { recursive, force: true });
  }
}
