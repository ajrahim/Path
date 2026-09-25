import { stat } from "node:fs/promises";
import type { RemoteRepositories } from "../storage/DatabaseClient";
import type { Diagnostics } from "../storage/DiagnosticLog";
import type { ManagedRecordingAssets } from "../storage/ManagedRecordingAssets";

// A ready recording smaller than this never held decodable media; re-mark it failed on startup.
const MINIMUM_READY_MEDIA_BYTES = 1_024;

// File checks run in parallel batches so a large library does not wait on one stat at a time.
const MEDIA_CHECK_CONCURRENCY = 16;

/**
 * Runs before history is exposed. Interrupted captures are marked failed with their incomplete
 * media queued for deletion in one transaction, and ready recordings whose media is missing,
 * empty, or outside the managed roots are marked failed so they can be retried or removed.
 */
export async function recoverRecordings(
  recordings: Pick<
    RemoteRepositories["recordings"],
    "failUnfinished" | "listReadyMedia" | "markFailed"
  >,
  assets: Pick<ManagedRecordingAssets, "isManagedFile">,
  diagnostics: Diagnostics,
): Promise<{ interruptedCount: number; missingMediaCount: number }> {
  const interrupted = await recordings.failUnfinished();
  const ready = await recordings.listReadyMedia();
  const missing: string[] = [];

  for (let start = 0; start < ready.length; start += MEDIA_CHECK_CONCURRENCY) {
    const batch = ready.slice(start, start + MEDIA_CHECK_CONCURRENCY);
    const checks = await Promise.all(
      batch.map(async (recording) => ({
        id: recording.id,
        isUsable: await hasUsableMedia(recording.videoPath, assets),
      })),
    );

    for (const check of checks) if (!check.isUsable) missing.push(check.id);
  }

  await recordings.markFailed(missing);

  if (interrupted.length > 0 || missing.length > 0) {
    diagnostics.warn(
      `Startup recovery: ${interrupted.length} interrupted and ${missing.length} unplayable recordings marked failed`,
    );
  }

  return { interruptedCount: interrupted.length, missingMediaCount: missing.length };
}

async function hasUsableMedia(
  videoPath: string | null,
  assets: Pick<ManagedRecordingAssets, "isManagedFile">,
): Promise<boolean> {
  if (!videoPath || !assets.isManagedFile(videoPath)) return false;

  try {
    return (await stat(videoPath)).size >= MINIMUM_READY_MEDIA_BYTES;
  } catch {
    return false;
  }
}
