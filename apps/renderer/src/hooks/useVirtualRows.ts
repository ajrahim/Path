import { useCallback, useEffect, useRef, useState } from "react";

// Rows rendered beyond each edge of the viewport so fast scrolling does not reveal gaps.
const OVERSCAN_ROWS = 8;

// Before the viewport is measured (static render or tests), render one typical screenful.
const UNMEASURED_VIEWPORT_ROWS = 20;

interface VirtualRows {
  attachContainer(element: HTMLElement | null): void;
  startIndex: number;
  endIndex: number;
  totalHeight: number;
  offsetTop: number;
  onScroll(): void;
  /** Scroll the least distance needed to show the row. */
  revealIndex(index: number): void;
}

/** Renders only the fixed-height rows near the viewport so large imports stay responsive. */
export function useVirtualRows(count: number, rowHeight: number): VirtualRows {
  // State drives measurement when the element mounts; the ref allows scrolling it in callbacks.
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const elementRef = useRef<HTMLElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    if (!container) return;

    const measure = () => setViewportHeight(container.clientHeight);

    measure();

    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(measure);

    observer.observe(container);

    return () => observer.disconnect();
  }, [container]);

  const attachContainer = useCallback((element: HTMLElement | null) => {
    elementRef.current = element;
    setContainer(element);
  }, []);

  const onScroll = useCallback(() => {
    if (elementRef.current) setScrollTop(elementRef.current.scrollTop);
  }, []);

  const revealIndex = useCallback(
    (index: number) => {
      const element = elementRef.current;

      if (!element) return;

      const rowTop = index * rowHeight;
      const rowBottom = rowTop + rowHeight;

      if (rowTop < element.scrollTop) {
        element.scrollTop = rowTop;
      } else if (rowBottom > element.scrollTop + element.clientHeight) {
        element.scrollTop = rowBottom - element.clientHeight;
      }

      setScrollTop(element.scrollTop);
    },
    [rowHeight],
  );

  const visibleRows =
    viewportHeight > 0 ? Math.ceil(viewportHeight / rowHeight) : UNMEASURED_VIEWPORT_ROWS;

  const firstVisible = Math.min(Math.floor(scrollTop / rowHeight), Math.max(0, count - 1));
  const startIndex = Math.max(0, firstVisible - OVERSCAN_ROWS);
  const endIndex = Math.min(count, firstVisible + visibleRows + OVERSCAN_ROWS);

  return {
    attachContainer,
    startIndex,
    endIndex,
    totalHeight: count * rowHeight,
    offsetTop: startIndex * rowHeight,
    onScroll,
    revealIndex,
  };
}
