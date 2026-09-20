import { useEffect, useMemo, useState } from "react";
import type { RecordingStatus } from "@path/shared";
import { getDesktopApi } from "@/lib/Desktop";

export function useRecordingThumbnailUrl(
  recordingId: string | null,
  status: RecordingStatus | null,
  thumbnailPath?: string | null,
): string | null {
  const source = useMemo(
    () => ({ recordingId, status, thumbnailPath }),
    [recordingId, status, thumbnailPath],
  );

  const [resource, setResource] = useState<{ source: typeof source; url: string | null } | null>(
    null,
  );

  useEffect(() => {
    let active = true;

    if (source.recordingId && source.status === "ready") {
      void getDesktopApi()
        ?.recordings.thumbnailUrl({ id: source.recordingId })
        .then((url) => {
          if (active) setResource({ source, url: url ?? null });
        })
        .catch(() => {
          if (active) setResource({ source, url: null });
        });
    }

    return () => {
      active = false;
    };
  }, [source]);

  return resource?.source === source ? resource.url : null;
}
