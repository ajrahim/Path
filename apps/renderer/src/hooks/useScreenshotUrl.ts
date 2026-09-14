import { useEffect, useMemo, useState } from "react";
import type { ClickEvent } from "@path/shared";
import { getDesktopApi } from "@/lib/Desktop";

export function useScreenshotUrl({ id, recordingId, screenshotPath }: ClickEvent): string | null {
  // Analysis can change the click description without changing the screenshot resource.
  const source = useMemo(
    () => ({ id, recordingId, screenshotPath }),
    [id, recordingId, screenshotPath],
  );

  const [resource, setResource] = useState<{ source: typeof source; url: string | null } | null>(
    null,
  );

  useEffect(() => {
    let active = true;

    if (source.screenshotPath) {
      void getDesktopApi()
        ?.recordings.screenshotUrl({ recordingId: source.recordingId, clickId: source.id })
        .then((url) => {
          if (active) setResource({ source, url });
        })
        .catch(() => {
          // Unavailable screenshots omit their optional action; playback still works.
          if (active) setResource({ source, url: null });
        });
    }

    return () => {
      active = false;
    };
  }, [source]);

  return resource?.source === source ? resource.url : null;
}
