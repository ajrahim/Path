export function formatDuration(durationMs: number | null, fallback: string): string {
  if (durationMs === null) {
    return fallback;
  }

  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return hours > 0
    ? [hours, minutes, seconds].map((part) => part.toString().padStart(2, "0")).join(":")
    : [minutes, seconds].map((part) => part.toString().padStart(2, "0")).join(":");
}

export function formatRecordingDate(value: string | number | Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export function formatRecordingTime(value: string | number | Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatDefaultRecordingTitle(
  value: string | number | Date = new Date(),
  locale = "en",
): string {
  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return "Recording";
  }

  const dateStr = formatRecordingDate(date, locale);
  const timeStr = formatRecordingTime(date, locale);

  return `${dateStr} - ${timeStr} recording`;
}

/** Media offset with millisecond precision, such as `01:02.345`. */
export function formatMediaOffset(timestampMs: number): string {
  const offset = Math.max(0, Math.floor(timestampMs));

  return `${formatDuration(offset, "")}.${(offset % 1000).toString().padStart(3, "0")}`;
}

/** Full wall-clock time with milliseconds and zone, for comparing against external logs. */
export function formatWallClockTimestamp(date: Date, locale: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
    hourCycle: "h23",
    timeZoneName: "shortOffset",
    timeZone,
  }).format(date);
}

export function formatWallClockTime(value: string | number | Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

/** Show capture time and media offset separately; they come from different clocks. */
export function formatClickTimestamp(
  capturedAt: string,
  timestampMs: number,
  locale: string,
  timeZone?: string,
): string {
  const videoTime = formatMediaOffset(timestampMs);
  const date = new Date(capturedAt);

  if (!Number.isFinite(date.getTime())) return videoTime;

  return `${formatWallClockTimestamp(date, locale, timeZone)} | ${videoTime}`;
}

export function formatPlayerTime(value: number): string {
  if (!Number.isFinite(value)) return "00:00";

  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);

  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}
