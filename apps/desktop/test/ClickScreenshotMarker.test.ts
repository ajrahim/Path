import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { addClickMarker } from "../src/recording/ClickScreenshotMarker";

function createImage(width = 100, height = 100): Buffer {
  const image = new PNG({ width, height });

  image.data.fill(255);

  return PNG.sync.write(image);
}

function pixelAt(image: PNG, x: number, y: number): number[] {
  const offset = (image.width * y + x) * 4;

  return [...image.data.subarray(offset, offset + 4)];
}

describe("addClickMarker", () => {
  it("draws a visible click ring at the normalized location", () => {
    const marked = PNG.sync.read(addClickMarker(createImage(), 0.5, 0.5));

    // Sample the hollow center, colored ring, and untouched background independently.
    expect(pixelAt(marked, 50, 50)).toEqual([255, 255, 255, 255]);
    expect(pixelAt(marked, 50, 39)[0]).toBeGreaterThan(200);
    expect(pixelAt(marked, 50, 39)[1]).toBeLessThan(100);
    expect(pixelAt(marked, 0, 0)).toEqual([255, 255, 255, 255]);
  });

  it("keeps markers inside the image when a coordinate reaches an edge", () => {
    const marked = PNG.sync.read(addClickMarker(createImage(), 1, 1));

    expect(pixelAt(marked, 99, 88)[1]).toBeLessThan(100);
    expect(pixelAt(marked, 0, 0)).toEqual([255, 255, 255, 255]);
  });

  it("rejects coordinates that cannot identify a click location", () => {
    expect(() => addClickMarker(createImage(), Number.NaN, 0.5)).toThrow(
      "Click coordinates must be finite numbers",
    );
  });
});
