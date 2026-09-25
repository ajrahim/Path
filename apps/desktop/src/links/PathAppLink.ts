import { posix, win32 } from "node:path";

const MAX_APP_LINK_LENGTH = 16_384;
const MAX_LOCAL_PATH_LENGTH = 4096;
const GENERATE_FIELDS = new Set([
  "videoPath",
  "title",
  "type",
  "documentType",
  "folder",
  "auto",
  "logPath",
  "elementsPath",
]);

export interface PathGenerateLink {
  route: "generate";
  videoPath: string;
  title: string;
  /** Reserved for a future recording type; currently has no behavioral effect. */
  type: string | null;
  documentType: string | null;
  folder: string | null;
  auto: boolean;
  logPath: string | null;
  elementsPath: string | null;
}

export type PathAppLink = { route: "open" } | { route: "status" } | PathGenerateLink;

/** Messages are safe to display without exposing the incoming URL or file contents. */
export class PathAppLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathAppLinkError";
  }
}

/** Parse the external protocol exactly once; filesystem checks belong to the import service. */
export function parsePathAppLink(raw: string): PathAppLink {
  if (raw.length > MAX_APP_LINK_LENGTH) {
    throw new PathAppLinkError("The Path link is too long (maximum 16,384 characters).");
  }

  if (!/^pathai:\/\//i.test(raw) || /[\u0000-\u0020\u007f]/.test(raw)) {
    throw new PathAppLinkError("Use a pathai:// link with URL-encoded query values.");
  }

  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw new PathAppLinkError("The Path link is not a valid URL.");
  }

  if (url.username || url.password || url.port || raw.includes("#")) {
    throw new PathAppLinkError("Path links cannot contain credentials, ports, or fragments.");
  }

  // Check the literal route too: URL parsing can silently normalize dot segments.
  const route = raw.slice(raw.indexOf("://") + 3).split("?", 1)[0];

  if (route === "" || route === "/") {
    if (url.search) throw new PathAppLinkError("The Path home link does not accept query fields.");

    return { route: "open" };
  }

  if (route === "status" || route === "status/") {
    if (url.search) {
      throw new PathAppLinkError("The Path status link does not accept query fields.");
    }

    return { route: "status" };
  }

  if (route !== "generate" && route !== "generate/") {
    throw new PathAppLinkError(
      "The Path link route is not supported. Use pathai://generate or pathai://status.",
    );
  }

  const fields = readQueryFields(url.search);
  const videoPath = localPath(fields, "videoPath");

  if (!videoPath) throw new PathAppLinkError("videoPath is required for pathai://generate.");

  const auto = fields.get("auto");

  if (auto !== undefined && auto !== "true" && auto !== "false") {
    throw new PathAppLinkError("auto must be true or false.");
  }

  const filename = /^[a-z]:[\\/]/i.test(videoPath)
    ? win32.parse(videoPath).name
    : posix.parse(videoPath).name;

  return {
    route: "generate",
    videoPath,
    title: nullableText(fields, "title", 120) ?? (filename.trim().slice(0, 120) || "Recording"),
    type: nullableText(fields, "type", 120),
    documentType: nullableText(fields, "documentType", 120),
    folder: nullableText(fields, "folder", 80),
    auto: auto === "true",
    logPath: localPath(fields, "logPath"),
    elementsPath: localPath(fields, "elementsPath"),
  };
}

function readQueryFields(search: string): Map<string, string> {
  const fields = new Map<string, string>();

  for (const pair of search.slice(1).split("&")) {
    if (!pair) continue;

    const separator = pair.indexOf("=");
    const rawKey = separator === -1 ? pair : pair.slice(0, separator);
    const rawValue = separator === -1 ? "" : pair.slice(separator + 1);
    let key: string;
    let value: string;

    try {
      // Standard query semantics: '+' is a space; a literal plus must be encoded as %2B.
      key = decodeURIComponent(rawKey.replace(/\+/g, " "));
      value = decodeURIComponent(rawValue.replace(/\+/g, " "));
    } catch {
      throw new PathAppLinkError("The Path link contains invalid URL encoding.");
    }

    if (!GENERATE_FIELDS.has(key)) {
      throw new PathAppLinkError("The Path link contains an unsupported query field.");
    }

    if (fields.has(key)) {
      throw new PathAppLinkError("The Path link contains a duplicate query field.");
    }

    fields.set(key, value);
  }

  return fields;
}

function nullableText(fields: Map<string, string>, key: string, maxLength: number): string | null {
  const value = fields.get(key)?.trim();

  if (!value || value === "null") return null;
  if (value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new PathAppLinkError(`${key} must be text of at most ${maxLength} characters.`);
  }

  return value;
}

function localPath(fields: Map<string, string>, key: string): string | null {
  const value = fields.get(key);

  if (value === undefined || value === "" || value === "null") return null;
  if (
    value.length > MAX_LOCAL_PATH_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    /^[\\/]{2}/.test(value)
  ) {
    throw new PathAppLinkError(`${key} must be an absolute path to a local file.`);
  }

  if (/^[a-z]:[\\/]/i.test(value)) {
    const segments = value.slice(3).split(/[\\/]/);
    const hasInvalidSegment = segments.some(
      (segment) =>
        /[<>:"|?*]/.test(segment) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment) ||
        (segment !== "." && segment !== ".." && /[. ]$/.test(segment)),
    );

    if (!hasInvalidSegment) return win32.normalize(value);
  } else if (value.startsWith("/") && !value.includes("\\")) {
    return posix.normalize(value);
  }

  throw new PathAppLinkError(`${key} must be an absolute path to a local file.`);
}
