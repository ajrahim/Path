import type { TimelineImportKind } from "@path/shared";

/** Bounds one row, including continuation lines such as stack traces. */
export const MAX_TIMELINE_IMPORT_ROW_LENGTH = 4_000;

const HALF_DAY_MS = 12 * 60 * 60 * 1_000;

// Anchored at the line start, optionally bracketed. A zone suffix makes the time absolute.
const DATE_TIME_PATTERN =
  /^\[?(\d{4})[-/](\d{2})[-/](\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,9}))? ?(Z|[+-]\d{2}:?\d{2})?\]?/i;

const TIME_ONLY_PATTERN = /^\[?(\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,9}))?\]?(?![\d:])/;
const EPOCH_PATTERN = /^\[?(\d{13}|\d{10})(?:\.(\d{1,6}))?\]?(?![\d.])/;

interface ParsedTimelineRow {
  occurredAtMs: number;
  text: string;
}

export interface ParsedTimelineImport {
  rows: ParsedTimelineRow[];
  unreadableLineCount: number;
}

type LeadingTimestamp =
  | { type: "absolute"; occurredAtMs: number; length: number }
  | { type: "time-of-day"; msOfDay: number; length: number };

/**
 * Split imported text into timestamped rows. Lines without a leading timestamp continue the
 * previous row; lines before the first row are unreadable. Timestamps without a zone use local
 * time, and time-only rows use the local date of `referenceMs`, advancing a day at midnight.
 */
export function parseTimelineImport(
  content: string,
  kind: TimelineImportKind,
  referenceMs: number,
): ParsedTimelineImport {
  const rows: ParsedTimelineRow[] = [];
  const reference = new Date(referenceMs);
  let unreadableLineCount = 0;
  let dayOffset = 0;
  let previousTimeOnlyMs: number | null = null;

  for (const rawLine of content.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = rawLine.trimEnd();

    if (!line.trim()) continue;

    const jsonRow = parseJsonRow(line, kind, reference);

    if (jsonRow) {
      rows.push(jsonRow);
      continue;
    }

    const timestamp = parseLeadingTimestamp(line);

    if (!timestamp) {
      const previous = rows.at(-1);

      if (previous) {
        previous.text = appendContinuation(previous.text, line);
      } else {
        unreadableLineCount += 1;
      }

      continue;
    }

    let occurredAtMs: number;

    if (timestamp.type === "absolute") {
      occurredAtMs = timestamp.occurredAtMs;
    } else {
      occurredAtMs = localTimeOfDay(reference, dayOffset, timestamp.msOfDay);

      // A time that jumps back by more than half a day crossed midnight.
      if (previousTimeOnlyMs !== null && occurredAtMs < previousTimeOnlyMs - HALF_DAY_MS) {
        dayOffset += 1;
        occurredAtMs = localTimeOfDay(reference, dayOffset, timestamp.msOfDay);
      }

      previousTimeOnlyMs = occurredAtMs;
    }

    rows.push({ occurredAtMs, text: rowText(line.slice(timestamp.length)) });
  }

  return {
    rows: rows.map((row) => ({ ...row, text: truncateRowText(row.text) })),
    unreadableLineCount,
  };
}

function parseLeadingTimestamp(text: string): LeadingTimestamp | null {
  const dateTime = DATE_TIME_PATTERN.exec(text);

  if (dateTime) {
    const occurredAtMs = dateTimeToMs(dateTime);

    return occurredAtMs === null
      ? null
      : { type: "absolute", occurredAtMs, length: dateTime[0].length };
  }

  const epoch = EPOCH_PATTERN.exec(text);

  if (epoch) {
    const [, digits = "", fraction = ""] = epoch;
    const occurredAtMs =
      digits.length === 13
        ? Number(digits)
        : Math.round(Number(`${digits}.${fraction || "0"}`) * 1_000);

    return { type: "absolute", occurredAtMs, length: epoch[0].length };
  }

  const timeOnly = TIME_ONLY_PATTERN.exec(text);

  if (!timeOnly) return null;

  // The pattern guarantees these groups; defaults only satisfy indexed-access typing.
  const [hours = 0, minutes = 0, seconds = 0] = timeOnly.slice(1, 4).map(Number);

  if (!isValidTime(hours, minutes, seconds)) return null;

  const msOfDay = ((hours * 60 + minutes) * 60 + seconds) * 1_000 + fractionToMs(timeOnly[4]);

  return { type: "time-of-day", msOfDay, length: timeOnly[0].length };
}

function dateTimeToMs(match: RegExpExecArray): number | null {
  const [year = 0, month = 0, day = 0, hours = 0, minutes = 0, seconds = 0] = match
    .slice(1, 7)
    .map(Number);

  const zone = match[8];

  if (!isValidTime(hours, minutes, seconds) || month < 1 || month > 12 || day < 1) return null;

  const milliseconds = fractionToMs(match[7]);

  // Reject calendar overflow such as February 31 instead of rolling into the next month.
  if (!zone) {
    const local = new Date(year, month - 1, day, hours, minutes, seconds, milliseconds);

    return local.getDate() === day && local.getMonth() === month - 1 ? local.getTime() : null;
  }

  const utcMs = Date.UTC(year, month - 1, day, hours, minutes, seconds, milliseconds);

  if (new Date(utcMs).getUTCDate() !== day) return null;

  return utcMs - zoneOffsetMinutes(zone) * 60_000;
}

function parseJsonRow(
  line: string,
  kind: TimelineImportKind,
  reference: Date,
): ParsedTimelineRow | null {
  if (!line.trimStart().startsWith("{")) return null;

  let value: unknown;

  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const occurredAtMs = jsonTimestampToMs(record.timestamp, reference);

  if (occurredAtMs === null) return null;

  const text = kind === "element" ? record.path : record.message;

  return { occurredAtMs, text: typeof text === "string" ? text.trim() : line.trim() };
}

function jsonTimestampToMs(value: unknown, reference: Date): number | null {
  // Values below 10^11 are epoch seconds; larger values are already milliseconds.
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value < 1e11 ? value * 1_000 : value);
  }

  if (typeof value !== "string") return null;

  const timestamp = parseLeadingTimestamp(value.trim());

  if (!timestamp) return null;

  return timestamp.type === "absolute"
    ? timestamp.occurredAtMs
    : localTimeOfDay(reference, 0, timestamp.msOfDay);
}

function localTimeOfDay(reference: Date, dayOffset: number, msOfDay: number): number {
  return new Date(
    reference.getFullYear(),
    reference.getMonth(),
    reference.getDate() + dayOffset,
    0,
    0,
    0,
    msOfDay,
  ).getTime();
}

function isValidTime(hours: number, minutes: number, seconds: number): boolean {
  return hours < 24 && minutes < 60 && seconds < 60;
}

function fractionToMs(fraction: string | undefined): number {
  return fraction ? Number(fraction.slice(0, 3).padEnd(3, "0")) : 0;
}

function zoneOffsetMinutes(zone: string): number {
  if (zone.toUpperCase() === "Z") return 0;

  const sign = zone.startsWith("-") ? -1 : 1;
  const digits = zone.slice(1).replace(":", "");

  return sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
}

/** Separators between a timestamp and its message are formatting, not content. */
function rowText(remainder: string): string {
  return remainder.replace(/^[\s\]|:,-]+/, "").trimEnd();
}

function appendContinuation(text: string, line: string): string {
  if (text.length > MAX_TIMELINE_IMPORT_ROW_LENGTH) return text;

  return text ? `${text}\n${line}` : line;
}

function truncateRowText(text: string): string {
  return text.length > MAX_TIMELINE_IMPORT_ROW_LENGTH
    ? `${text.slice(0, MAX_TIMELINE_IMPORT_ROW_LENGTH - 1)}…`
    : text;
}
