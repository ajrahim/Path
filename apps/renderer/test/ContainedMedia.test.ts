import { describe, expect, it } from "vitest";
import { containedMediaRect } from "../src/lib/ContainedMedia";

describe("containedMediaRect", () => {
  it("centers pillarboxed media", () => {
    expect(containedMediaRect({ width: 800, height: 400 }, { width: 400, height: 400 })).toEqual({
      left: 200,
      top: 0,
      width: 400,
      height: 400,
    });
  });

  it("centers letterboxed media", () => {
    expect(containedMediaRect({ width: 400, height: 400 }, { width: 800, height: 400 })).toEqual({
      left: 0,
      top: 100,
      width: 400,
      height: 200,
    });
  });

  it("rejects incomplete dimensions", () => {
    expect(containedMediaRect({ width: 400, height: 0 }, { width: 800, height: 400 })).toBeNull();
  });
});
