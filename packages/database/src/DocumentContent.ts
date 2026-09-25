import { createHash } from "node:crypto";
import type { DocumentBodyEncoding } from "./Schema";

// Private-use delimiters mark an image reference inside a stored revision body.
const IMAGE_REFERENCE_START = "";
const IMAGE_REFERENCE_END = "";
const IMAGE_REFERENCE_PATTERN = /([0-9a-f]{64})/g;

// Images pasted or inserted into the editor are embedded as base64 data URLs.
const EMBEDDED_IMAGE_PATTERN = /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/]+=*/gi;

// Small images cost less inline than as a separate row.
const MIN_SEPARATELY_STORED_IMAGE_LENGTH = 1_024;

export interface EncodedDocumentBody {
  body: string;
  encoding: DocumentBodyEncoding;
  images: { hash: string; dataUrl: string }[];
}

export function hashContent(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Replace large embedded images with references so repeated revisions store each image once.
 * Text that already contains the private delimiters is stored verbatim, keeping decoding exact.
 */
export function encodeDocumentBody(markdown: string): EncodedDocumentBody {
  if (markdown.includes(IMAGE_REFERENCE_START) || markdown.includes(IMAGE_REFERENCE_END)) {
    return { body: markdown, encoding: "plain", images: [] };
  }

  const images = new Map<string, string>();
  const body = markdown.replace(EMBEDDED_IMAGE_PATTERN, (dataUrl) => {
    if (dataUrl.length < MIN_SEPARATELY_STORED_IMAGE_LENGTH) return dataUrl;

    const hash = hashContent(dataUrl);

    images.set(hash, dataUrl);

    return `${IMAGE_REFERENCE_START}${hash}${IMAGE_REFERENCE_END}`;
  });

  if (images.size === 0) return { body: markdown, encoding: "plain", images: [] };

  return {
    body,
    encoding: "image-refs",
    images: [...images].map(([hash, dataUrl]) => ({ hash, dataUrl })),
  };
}

export function referencedImageHashes(body: string, encoding: DocumentBodyEncoding): string[] {
  if (encoding === "plain") return [];

  return [...new Set([...body.matchAll(IMAGE_REFERENCE_PATTERN)].map((match) => match[1] ?? ""))];
}

export function decodeDocumentBody(
  body: string,
  encoding: DocumentBodyEncoding,
  images: ReadonlyMap<string, string>,
): string {
  if (encoding === "plain") return body;

  return body.replace(IMAGE_REFERENCE_PATTERN, (_reference, hash: string) => {
    const dataUrl = images.get(hash);

    // Images are only ever inserted with the revision that references them.
    if (dataUrl === undefined) throw new Error(`Stored document image is missing: ${hash}`);

    return dataUrl;
  });
}
