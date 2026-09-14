export interface MediaSize {
  width: number;
  height: number;
}

export interface ContainedMediaRect extends MediaSize {
  left: number;
  top: number;
}

/** Returns centered object-fit: contain bounds in the container's coordinate units. */
export function containedMediaRect(
  container: MediaSize,
  media: MediaSize,
): ContainedMediaRect | null {
  if (container.width <= 0 || container.height <= 0 || media.width <= 0 || media.height <= 0) {
    return null;
  }

  // Hotspots use the visible image bounds, excluding object-fit: contain letterboxing.
  const scale = Math.min(container.width / media.width, container.height / media.height);
  const width = media.width * scale;
  const height = media.height * scale;

  return {
    left: (container.width - width) / 2,
    top: (container.height - height) / 2,
    width,
    height,
  };
}
