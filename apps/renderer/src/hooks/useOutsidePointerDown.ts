import { useEffect, useEffectEvent, type RefObject } from "react";

/** While `isActive`, calls `onOutside` when a pointer press lands outside every given element. */
export function useOutsidePointerDown(
  isActive: boolean,
  insideRefs: readonly RefObject<Element | null>[],
  onOutside: () => void,
): void {
  const handlePointerDown = useEffectEvent((event: PointerEvent) => {
    const target = event.target;
    const isInside =
      target instanceof Node && insideRefs.some((ref) => ref.current?.contains(target));

    if (!isInside) onOutside();
  });

  useEffect(() => {
    if (!isActive) return;

    const listener = (event: PointerEvent) => handlePointerDown(event);

    document.addEventListener("pointerdown", listener);

    return () => document.removeEventListener("pointerdown", listener);
  }, [isActive]);
}
