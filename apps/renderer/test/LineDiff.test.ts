import { describe, expect, it } from "vitest";
import { diffLines, type LineChange } from "../src/lib/LineDiff";

function apply(changes: LineChange[], side: "before" | "after"): string {
  return changes
    .filter(
      (change) =>
        change.type === "same" || change.type === (side === "before" ? "removed" : "added"),
    )
    .map((change) => change.text)
    .join("\n");
}

describe("line diff", () => {
  it("marks added, removed, and unchanged lines", () => {
    expect(
      diffLines("# Guide\nStep one\nStep two", "# Guide\nStep one\nStep 1.5\nStep two"),
    ).toEqual([
      { type: "same", text: "# Guide" },
      { type: "same", text: "Step one" },
      { type: "added", text: "Step 1.5" },
      { type: "same", text: "Step two" },
    ]);
    expect(diffLines("a\nb\nc", "a\nc")).toEqual([
      { type: "same", text: "a" },
      { type: "removed", text: "b" },
      { type: "same", text: "c" },
    ]);
  });

  it("reproduces both texts exactly for arbitrary edits", () => {
    const random = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const next = random(42);

    for (let trial = 0; trial < 50; trial += 1) {
      const words = ["alpha", "beta", "gamma", "delta", "", "# Heading"];
      const before = Array.from(
        { length: Math.floor(next() * 30) },
        () => words[Math.floor(next() * 6)],
      ).join("\n");

      const after = Array.from(
        { length: Math.floor(next() * 30) },
        () => words[Math.floor(next() * 6)],
      ).join("\n");

      const changes = diffLines(before, after);

      expect(apply(changes, "before")).toBe(before);
      expect(apply(changes, "after")).toBe(after);
    }
  });

  it("returns only unchanged lines for identical text", () => {
    expect(diffLines("same\ntext", "same\ntext").every((change) => change.type === "same")).toBe(
      true,
    );
  });
});
