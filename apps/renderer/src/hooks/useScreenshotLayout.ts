import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { containedMediaRect, type ContainedMediaRect } from "@/lib/ContainedMedia";

export function useScreenshotLayout(url: string): {
  containerRef: RefObject<HTMLDivElement | null>;
  imageLayout: ContainedMediaRect | null;
} {
  // Suppress old hotspot geometry until the current image has been measured.
  const source = useMemo(() => ({ url }), [url]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<{
    source: typeof source;
    rect: ContainedMediaRect | null;
  } | null>(null);

  useEffect(() => {
    const containerElement = containerRef.current;

    if (!containerElement) return;

    const measuredContainer: HTMLDivElement = containerElement;

    let active = true;
    const image = new Image();

    function updateLayout(): void {
      if (!active) return;

      setLayout({
        source,
        rect: containedMediaRect(
          { width: measuredContainer.clientWidth, height: measuredContainer.clientHeight },
          { width: image.naturalWidth, height: image.naturalHeight },
        ),
      });
    }

    image.addEventListener("load", updateLayout);
    image.src = source.url;
    const observer = new ResizeObserver(updateLayout);

    observer.observe(containerElement);

    return () => {
      active = false;
      observer.disconnect();
      image.removeEventListener("load", updateLayout);
    };
  }, [source]);

  return { containerRef, imageLayout: layout?.source === source ? layout.rect : null };
}
