export interface LineChange {
  type: "same" | "added" | "removed";
  text: string;
}

// Bounds the diff's working memory; larger comparisons show a whole-block replacement instead.
const MAX_DIFF_WORK = 4_000_000;

/**
 * Line-by-line comparison of two Markdown texts using the shortest edit script (Myers). Shared
 * leading and trailing lines are matched first so typical revisions stay cheap to compare.
 */
export function diffLines(before: string, after: string): LineChange[] {
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  let start = 0;
  let oldEnd = oldLines.length;
  let newEnd = newLines.length;

  while (start < oldEnd && start < newEnd && oldLines[start] === newLines[start]) start += 1;

  while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd -= 1;
    newEnd -= 1;
  }

  const same = (text: string): LineChange => ({ type: "same", text });

  return [
    ...oldLines.slice(0, start).map(same),
    ...shortestEditScript(oldLines.slice(start, oldEnd), newLines.slice(start, newEnd)),
    ...oldLines.slice(oldEnd).map(same),
  ];
}

function shortestEditScript(oldLines: string[], newLines: string[]): LineChange[] {
  const maxDistance = oldLines.length + newLines.length;
  const offset = maxDistance + 1;
  const furthest = new Int32Array(2 * maxDistance + 3);
  const trace: Int32Array[] = [];

  for (let distance = 0; distance <= maxDistance; distance += 1) {
    if ((trace.length + 1) * furthest.length > MAX_DIFF_WORK) break;

    trace.push(furthest.slice());

    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const movesDown =
        diagonal === -distance ||
        (diagonal !== distance &&
          (furthest[offset + diagonal - 1] ?? 0) < (furthest[offset + diagonal + 1] ?? 0));

      let x = movesDown
        ? (furthest[offset + diagonal + 1] ?? 0)
        : (furthest[offset + diagonal - 1] ?? 0) + 1;

      let y = x - diagonal;

      while (x < oldLines.length && y < newLines.length && oldLines[x] === newLines[y]) {
        x += 1;
        y += 1;
      }

      furthest[offset + diagonal] = x;

      if (x >= oldLines.length && y >= newLines.length) {
        return backtrack(trace, oldLines, newLines, offset);
      }
    }
  }

  return [
    ...oldLines.map((text): LineChange => ({ type: "removed", text })),
    ...newLines.map((text): LineChange => ({ type: "added", text })),
  ];
}

function backtrack(
  trace: Int32Array[],
  oldLines: string[],
  newLines: string[],
  offset: number,
): LineChange[] {
  const changes: LineChange[] = [];
  let x = oldLines.length;
  let y = newLines.length;

  for (let distance = trace.length - 1; distance >= 0; distance -= 1) {
    const furthest = trace[distance] ?? new Int32Array();
    const diagonal = x - y;
    const cameFromAbove =
      diagonal === -distance ||
      (diagonal !== distance &&
        (furthest[offset + diagonal - 1] ?? 0) < (furthest[offset + diagonal + 1] ?? 0));

    const previousDiagonal = cameFromAbove ? diagonal + 1 : diagonal - 1;
    const previousX = furthest[offset + previousDiagonal] ?? 0;
    const previousY = previousX - previousDiagonal;

    while (x > previousX && y > previousY) {
      changes.push({ type: "same", text: oldLines[x - 1] ?? "" });
      x -= 1;
      y -= 1;
    }

    if (distance === 0) break;

    if (x === previousX) {
      changes.push({ type: "added", text: newLines[y - 1] ?? "" });
      y -= 1;
    } else {
      changes.push({ type: "removed", text: oldLines[x - 1] ?? "" });
      x -= 1;
    }
  }

  return changes.reverse();
}
