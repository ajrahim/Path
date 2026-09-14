import { describe, expect, it } from "vitest";
import { mapClickCoordinates, type DisplayCoordinateSpace, type Rectangle } from "../src";

const captureRegion: Rectangle = { x: 100, y: 100, width: 800, height: 600 };

function map(globalPoint: { x: number; y: number }, display: DisplayCoordinateSpace) {
  return mapClickCoordinates({
    globalPoint,
    display,
    captureRegion,
    videoFrame: { width: 1600, height: 1200 },
  });
}

describe("mapClickCoordinates", () => {
  it("maps 100% scaling into capture and video coordinates", () => {
    const result = map(
      { x: 500, y: 400 },
      {
        id: "primary",
        globalBounds: { x: 0, y: 0, width: 1920, height: 1080 },
        electronBounds: { x: 0, y: 0, width: 1920, height: 1080 },
        scaleFactor: 1,
      },
    );

    expect(result.insideCaptureRegion).toBe(true);
    expect(result.displayX).toBeCloseTo(500);
    expect(result.displayY).toBeCloseTo(400);
    expect(result.captureX).toBeCloseTo(400);
    expect(result.captureY).toBeCloseTo(300);
    expect(result.videoX).toBeCloseTo(800);
    expect(result.videoY).toBeCloseTo(600);
    expect(result.normalizedX).toBeCloseTo(0.5);
    expect(result.normalizedY).toBeCloseTo(0.5);
  });

  it.each([
    ["Windows 125%", 1.25, 2400, 1350, 1920, 1080],
    ["Retina 2x", 2, 2880, 1800, 1440, 900],
  ])(
    "maps physical pixels at %s scaling",
    (_name, scaleFactor, physicalWidth, physicalHeight, dipWidth, dipHeight) => {
      // The physical center must map to the DIP center regardless of the native scale factor.
      const result = map(
        { x: physicalWidth / 2, y: physicalHeight / 2 },
        {
          id: "scaled",
          globalBounds: { x: 0, y: 0, width: physicalWidth, height: physicalHeight },
          electronBounds: { x: 0, y: 0, width: dipWidth, height: dipHeight },
          scaleFactor,
        },
      );

      expect(result.displayX).toBe(dipWidth / 2);
      expect(result.displayY).toBe(dipHeight / 2);
    },
  );

  it("maps a monitor positioned left of the primary display", () => {
    // This display's local click remains meaningful even though the capture is on another monitor.
    const result = map(
      { x: -1280, y: 400 },
      {
        id: "left",
        globalBounds: { x: -2560, y: 0, width: 2560, height: 1440 },
        electronBounds: { x: -1280, y: 0, width: 1280, height: 720 },
        scaleFactor: 2,
      },
    );

    expect(result.displayX).toBe(640);
    expect(result.insideCaptureRegion).toBe(false);
  });

  it("maps a monitor positioned above the primary display", () => {
    const result = map(
      { x: 500, y: -600 },
      {
        id: "above",
        globalBounds: { x: 0, y: -1200, width: 1920, height: 1200 },
        electronBounds: { x: 0, y: -1200, width: 1920, height: 1200 },
        scaleFactor: 1,
      },
    );

    expect(result.displayY).toBe(600);
    expect(result.insideCaptureRegion).toBe(false);
  });

  it("returns null capture coordinates outside the region", () => {
    const result = map(
      { x: 99, y: 200 },
      {
        id: "primary",
        globalBounds: { x: 0, y: 0, width: 1920, height: 1080 },
        electronBounds: { x: 0, y: 0, width: 1920, height: 1080 },
        scaleFactor: 1,
      },
    );

    expect(result.insideCaptureRegion).toBe(false);
    expect(result.captureX).toBeNull();
    expect(result.normalizedX).toBeNull();
  });

  it("includes top-left and excludes bottom-right region borders", () => {
    const display: DisplayCoordinateSpace = {
      id: "primary",
      globalBounds: { x: 0, y: 0, width: 1920, height: 1080 },
      electronBounds: { x: 0, y: 0, width: 1920, height: 1080 },
      scaleFactor: 1,
    };

    expect(map({ x: 100, y: 100 }, display).insideCaptureRegion).toBe(true);
    expect(map({ x: 900, y: 700 }, display).insideCaptureRegion).toBe(false);
  });
});
