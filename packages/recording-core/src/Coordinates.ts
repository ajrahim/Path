interface Point {
  x: number;
  y: number;
}

export interface Rectangle extends Point {
  width: number;
  height: number;
}

/** Native hook bounds and Electron DIP bounds describe the same physical display. */
export interface DisplayCoordinateSpace {
  id: string;
  globalBounds: Rectangle;
  electronBounds: Rectangle;
  scaleFactor: number;
}

/** Capture bounds use global Electron DIPs; video dimensions use output pixels. */
export interface CoordinateMappingInput {
  globalPoint: Point;
  display: DisplayCoordinateSpace;
  captureRegion: Rectangle;
  videoFrame: { width: number; height: number };
}

/** Display offsets remain available even when capture/video coordinates cannot be produced. */
export interface CoordinateMappingResult {
  displayId: string;
  displayX: number;
  displayY: number;
  captureX: number | null;
  captureY: number | null;
  videoX: number | null;
  videoY: number | null;
  normalizedX: number | null;
  normalizedY: number | null;
  insideCaptureRegion: boolean;
}

function scalePosition(value: number, sourceStart: number, sourceSize: number, targetSize: number) {
  return ((value - sourceStart) / sourceSize) * targetSize;
}

/** Pure bounds-to-bounds mapping; output hotspots use fractions of the capture rectangle. */
export function mapClickCoordinates({
  globalPoint,
  display,
  captureRegion,
  videoFrame,
}: CoordinateMappingInput): CoordinateMappingResult {
  if (
    display.globalBounds.width <= 0 ||
    display.globalBounds.height <= 0 ||
    captureRegion.width <= 0 ||
    captureRegion.height <= 0 ||
    videoFrame.width <= 0 ||
    videoFrame.height <= 0
  ) {
    throw new RangeError("Coordinate spaces must have positive dimensions");
  }

  // Native hooks can report physical pixels while Electron uses device-independent
  // pixels. Mapping bounds-to-bounds also handles negative monitor origins.
  const displayX = scalePosition(
    globalPoint.x,
    display.globalBounds.x,
    display.globalBounds.width,
    display.electronBounds.width,
  );

  const displayY = scalePosition(
    globalPoint.y,
    display.globalBounds.y,
    display.globalBounds.height,
    display.electronBounds.height,
  );

  const electronX = display.electronBounds.x + displayX;
  const electronY = display.electronBounds.y + displayY;
  const captureX = electronX - captureRegion.x;
  const captureY = electronY - captureRegion.y;

  // Exclusive right/bottom edges keep a border click out of the next capture region.
  const insideCaptureRegion =
    captureX >= 0 &&
    captureY >= 0 &&
    captureX < captureRegion.width &&
    captureY < captureRegion.height;

  if (!insideCaptureRegion) {
    return {
      displayId: display.id,
      displayX,
      displayY,
      captureX: null,
      captureY: null,
      videoX: null,
      videoY: null,
      normalizedX: null,
      normalizedY: null,
      insideCaptureRegion: false,
    };
  }

  const normalizedX = captureX / captureRegion.width;
  const normalizedY = captureY / captureRegion.height;

  return {
    displayId: display.id,
    displayX,
    displayY,
    captureX,
    captureY,
    videoX: normalizedX * videoFrame.width,
    videoY: normalizedY * videoFrame.height,
    normalizedX,
    normalizedY,
    insideCaptureRegion: true,
  };
}
