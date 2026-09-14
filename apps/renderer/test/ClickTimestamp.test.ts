import { describe, expect, it } from "vitest";
import { formatClickTimestamp } from "../src/lib/Format";

describe("click timestamp tooltip", () => {
  it("pairs the actual captured time with the video offset including milliseconds", () => {
    const result = formatClickTimestamp("2026-09-13T10:20:31.456Z", 1234, "en-US", "UTC");

    expect(result).toContain("09/13/2026");
    expect(result).toContain("10:20:31.456 GMT");
    expect(result).toContain(" | 00:01.234");
  });

  it("includes the local date and offset across midnight", () => {
    const result = formatClickTimestamp(
      "2026-09-13T01:00:00.000Z",
      3600123,
      "en-US",
      "America/New_York",
    );

    expect(result).toContain("09/12/2026");
    expect(result).toContain("21:00:00.000 GMT-4");
    expect(result).toContain(" | 01:00:00.123");
  });

  it("does not invent an actual time when capture metadata is invalid", () => {
    expect(formatClickTimestamp("invalid", 2000, "en-US", "UTC")).toBe("00:02.000");
  });
});
