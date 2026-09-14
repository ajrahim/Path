import { useEffect, useMemo, useState } from "react";
import type { RecordingStatus } from "@path/shared";
import { getDesktopApi } from "@/lib/Desktop";

type RecordingMedia =
  { status: "idle" | "loading" | "error"; url: null } | { status: "ready"; url: string };

interface MediaSource {
  recordingId: string | null;
  recordingStatus: RecordingStatus | null;
}

interface MediaResource {
  source: MediaSource;
  media: RecordingMedia;
}

/** Loads a playable resource for one recording and releases its fetch and object URL on exit. */
export function useRecordingMedia(
  recordingId: string | null,
  recordingStatus: RecordingStatus | null,
): RecordingMedia {
  // Revisiting the same ID gets a new identity, so a previously revoked URL cannot reappear.
  const source = useMemo(() => ({ recordingId, recordingStatus }), [recordingId, recordingStatus]);
  const [resource, setResource] = useState<MediaResource | null>(null);

  useEffect(() => {
    const { recordingId, recordingStatus } = source;

    if (!recordingId || recordingStatus !== "ready") return;

    const mediaRecordingId = recordingId;
    const controller = new AbortController();
    let objectUrl: string | null = null;

    async function loadMedia(): Promise<void> {
      try {
        const sourceUrl = await getDesktopApi()?.recordings.mediaUrl({ id: mediaRecordingId });

        if (controller.signal.aborted) return;

        if (!sourceUrl) throw new Error("Recording media is unavailable");

        const response = await fetch(sourceUrl, { signal: controller.signal });

        if (!response.ok) throw new Error(`Recording media request failed: ${response.status}`);

        const media = await response.blob();

        // Native URL lookup and blob decoding may finish after fetch was aborted.
        if (controller.signal.aborted) return;

        objectUrl = URL.createObjectURL(
          media.type === "video/mp4" ? media : new Blob([media], { type: "video/mp4" }),
        );
        setResource({ source, media: { status: "ready", url: objectUrl } });
      } catch {
        if (!controller.signal.aborted) {
          setResource({ source, media: { status: "error", url: null } });
        }
      }
    }

    void loadMedia();

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source]);

  if (!recordingId || recordingStatus !== "ready") return { status: "idle", url: null };

  if (resource?.source === source) return resource.media;

  return { status: "loading", url: null };
}
