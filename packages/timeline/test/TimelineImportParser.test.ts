import { describe, expect, it } from "vitest";
import { MAX_TIMELINE_IMPORT_ROW_LENGTH, parseTimelineImport } from "../src/TimelineImportParser";

// Local-time expectations use the same constructor as the parser, so they hold in any zone.
const reference = new Date(2026, 8, 14, 10, 0, 0).getTime();

describe("timeline import parsing", () => {
  it("reads zoned ISO timestamps and strips separators from the message", () => {
    const parsed = parseTimelineImport(
      [
        "2026-09-14T10:00:01.250Z INFO Started",
        "[2026-09-14 12:00:02+02:00] | Saved form",
        "2026-09-14T10:00:03,5-0000 - Done",
      ].join("\n"),
      "log",
      reference,
    );

    expect(parsed.rows).toEqual([
      { occurredAtMs: Date.parse("2026-09-14T10:00:01.250Z"), text: "INFO Started" },
      { occurredAtMs: Date.parse("2026-09-14T10:00:02.000Z"), text: "Saved form" },
      { occurredAtMs: Date.parse("2026-09-14T10:00:03.500Z"), text: "Done" },
    ]);
    expect(parsed.unreadableLineCount).toBe(0);
  });

  it("uses local time for timestamps without a zone", () => {
    const parsed = parseTimelineImport(
      "2026/09/14 10:00:04.123456 click\n2026-09-14 10:00:05 next",
      "log",
      reference,
    );

    expect(parsed.rows.map((row) => row.occurredAtMs)).toEqual([
      new Date(2026, 8, 14, 10, 0, 4, 123).getTime(),
      new Date(2026, 8, 14, 10, 0, 5).getTime(),
    ]);
  });

  it("reads epoch seconds and milliseconds", () => {
    const parsed = parseTimelineImport(
      "1789466400 seconds\n1789466400.5 fractional\n1789466401250 milliseconds",
      "log",
      reference,
    );

    expect(parsed.rows.map((row) => [row.occurredAtMs, row.text])).toEqual([
      [1_789_466_400_000, "seconds"],
      [1_789_466_400_500, "fractional"],
      [1_789_466_401_250, "milliseconds"],
    ]);
  });

  it("resolves time-only rows against the recording date and advances at midnight", () => {
    const lateReference = new Date(2026, 8, 14, 23, 59, 0).getTime();
    const parsed = parseTimelineImport(
      "23:59:58.100 before midnight\n00:00:01 after midnight",
      "log",
      lateReference,
    );

    expect(parsed.rows.map((row) => row.occurredAtMs)).toEqual([
      new Date(2026, 8, 14, 23, 59, 58, 100).getTime(),
      new Date(2026, 8, 15, 0, 0, 1).getTime(),
    ]);
  });

  it("appends untimestamped lines to the previous row and counts leading ones", () => {
    const parsed = parseTimelineImport(
      [
        "﻿header without a time",
        "",
        "2026-09-14T10:00:01Z Error: failed",
        "    at save (form.ts:10)",
        "    at submit (form.ts:20)",
      ].join("\r\n"),
      "log",
      reference,
    );

    expect(parsed.unreadableLineCount).toBe(1);
    expect(parsed.rows).toEqual([
      {
        occurredAtMs: Date.parse("2026-09-14T10:00:01Z"),
        text: "Error: failed\n    at save (form.ts:10)\n    at submit (form.ts:20)",
      },
    ]);
  });

  it("rejects impossible dates instead of rolling them over", () => {
    const parsed = parseTimelineImport("2026-02-31T10:00:00Z invalid", "log", reference);

    expect(parsed.rows).toEqual([]);
    expect(parsed.unreadableLineCount).toBe(1);
  });

  it("reads JSON Lines rows using the field for each kind", () => {
    const content = [
      '{"timestamp": "2026-09-14T10:00:01Z", "path": "Header > #nav > .menu > #first"}',
      '{"timestamp": 1789466402000, "message": "Log message", "path": "Body"}',
    ].join("\n");

    const elements = parseTimelineImport(content, "element", reference);
    const logs = parseTimelineImport(content, "log", reference);

    expect(elements.rows.map((row) => row.text)).toEqual([
      "Header > #nav > .menu > #first",
      "Body",
    ]);
    expect(logs.rows[1]).toEqual({ occurredAtMs: 1_789_466_402_000, text: "Log message" });
    expect(logs.rows[0]?.text).toBe(
      '{"timestamp": "2026-09-14T10:00:01Z", "path": "Header > #nav > .menu > #first"}',
    );
  });

  it("bounds each row, including continuation lines", () => {
    const longLine = "x".repeat(MAX_TIMELINE_IMPORT_ROW_LENGTH);
    const parsed = parseTimelineImport(
      `2026-09-14T10:00:01Z ${longLine}\n${longLine}\n${longLine}`,
      "log",
      reference,
    );

    expect(parsed.rows[0]?.text).toHaveLength(MAX_TIMELINE_IMPORT_ROW_LENGTH);
    expect(parsed.rows[0]?.text.endsWith("…")).toBe(true);
  });
});
