import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname } from "node:path";
import { pipeline } from "node:stream/promises";
import type { RecordingRepository } from "@path/database";
import { recordingIdInputSchema } from "@path/shared";
import type { ManagedRecordingAssets } from "../storage/ManagedRecordingAssets";

function parseRange(
  value: string | undefined,
  size: number,
): { start: number; end: number } | null {
  const match = value?.match(/^bytes=(\d*)-(\d*)$/);

  if (!match || size <= 0) return null;
  if (!match[1] && !match[2]) return null;

  // A suffix range addresses the last N bytes rather than an absolute start offset.
  if (!match[1]) {
    const suffixLength = Number(match[2]);

    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;

    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;

  if (!Number.isSafeInteger(start) || start < 0 || start >= size) return null;
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) return null;

  return { start, end: Math.min(requestedEnd, size - 1) };
}

// Serves repository-owned media to browser renderers without exposing arbitrary filesystem paths.
export class RecordingMediaServer {
  // Loopback requests still need a per-launch capability token before accessing private media.
  private readonly token = randomUUID();
  private server: Server | null = null;
  private port: number | null = null;

  constructor(
    private readonly recordings: RecordingRepository,
    private readonly assets: ManagedRecordingAssets,
  ) {}

  async start(): Promise<void> {
    this.server = createServer((request, response) => void this.respond(request, response));
    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(0, "127.0.0.1", () => {
        const address = this.server?.address();

        if (!address || typeof address === "string") {
          return reject(new Error("Unable to bind media server"));
        }

        this.port = address.port;
        resolve();
      });
    });
  }

  url(recordingId: string): string {
    if (!this.port) throw new Error("Recording media server is not running");

    return `http://127.0.0.1:${this.port}/recordings/${recordingId}/recording.mp4?token=${this.token}`;
  }

  screenshotUrl(recordingId: string, clickId: string): string {
    if (!this.port) throw new Error("Recording media server is not running");

    return `http://127.0.0.1:${this.port}/recordings/${recordingId}/screenshots/${clickId}.png?token=${this.token}`;
  }

  thumbnailUrl(recordingId: string): string {
    if (!this.port) throw new Error("Recording media server is not running");

    return `http://127.0.0.1:${this.port}/recordings/${recordingId}/thumbnail.png?token=${this.token}`;
  }

  close(): void {
    this.server?.close();
    this.server = null;
    this.port = null;
  }

  private async respond(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.setHeader(
        "Access-Control-Expose-Headers",
        "Accept-Ranges, Content-Length, Content-Range, Content-Type",
      );
      response.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

      if (request.method === "OPTIONS") {
        response.setHeader("Access-Control-Allow-Headers", "Range");
        response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");

        return void response.writeHead(204).end();
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        response.setHeader("Allow", "GET, HEAD, OPTIONS");

        return void response.writeHead(405).end();
      }

      const url = new URL(request.url ?? "/", "http://127.0.0.1");

      if (url.searchParams.get("token") !== this.token) {
        return void response.writeHead(403).end();
      }

      const screenshotMatch = url.pathname.match(
        /^\/recordings\/([^/]+)\/screenshots\/([^/]+)\.png$/,
      );

      if (screenshotMatch) {
        const { id: recordingId } = recordingIdInputSchema.parse({ id: screenshotMatch[1] });
        const { id: clickId } = recordingIdInputSchema.parse({ id: screenshotMatch[2] });
        const click = await this.recordings.getClick(recordingId, clickId);

        if (!click?.screenshotPath || !this.assets.isManagedFile(click.screenshotPath)) {
          return void response.writeHead(404).end();
        }

        let image;

        try {
          image = await stat(click.screenshotPath);
        } catch {
          return void response.writeHead(404).end();
        }

        response.setHeader("Cache-Control", "private, no-store");
        response.setHeader("Content-Length", image.size);
        response.setHeader("Content-Type", "image/png");
        response.writeHead(200);

        if (request.method === "HEAD") return void response.end();

        await pipeline(createReadStream(click.screenshotPath), response);

        return;
      }

      const thumbnailMatch = url.pathname.match(/^\/recordings\/([^/]+)\/thumbnail\.png$/);

      if (thumbnailMatch) {
        const { id } = recordingIdInputSchema.parse({ id: thumbnailMatch[1] });
        const recording = await this.recordings.get(id);
        const thumbnailPath = recording?.thumbnailPath ?? this.assets.thumbnailPath(id);

        if (!thumbnailPath || !this.assets.isManagedFile(thumbnailPath)) {
          return void response.writeHead(404).end();
        }

        let image;

        try {
          image = await stat(thumbnailPath);
        } catch {
          return void response.writeHead(404).end();
        }

        response.setHeader("Cache-Control", "private, no-store");
        response.setHeader("Content-Length", image.size);
        response.setHeader("Content-Type", "image/png");
        response.writeHead(200);

        if (request.method === "HEAD") return void response.end();

        await pipeline(createReadStream(thumbnailPath), response);

        return;
      }

      const match = url.pathname.match(/^\/recordings\/([^/]+)\/recording\.mp4$/);
      const { id } = recordingIdInputSchema.parse({ id: match?.[1] });
      const recording = await this.recordings.get(id);

      if (!recording?.videoPath || !this.assets.isManagedFile(recording.videoPath)) {
        return void response.writeHead(404).end();
      }

      let file;

      try {
        file = await stat(recording.videoPath);
      } catch {
        return void response.writeHead(404).end();
      }

      const range = parseRange(request.headers.range, file.size);

      if (request.headers.range && !range) {
        response.setHeader("Content-Range", `bytes */${file.size}`);

        return void response.writeHead(416).end();
      }

      const start = range?.start ?? 0;
      const end = range?.end ?? file.size - 1;

      response.setHeader("Accept-Ranges", "bytes");
      response.setHeader("Cache-Control", "private, no-store");
      response.setHeader("Content-Length", end - start + 1);
      response.setHeader(
        "Content-Type",
        extname(recording.videoPath) === ".mp4" ? "video/mp4" : "video/webm",
      );

      if (range) {
        response.setHeader("Content-Range", `bytes ${start}-${end}/${file.size}`);
      }

      response.writeHead(range ? 206 : 200);

      if (request.method === "HEAD" || file.size === 0) return void response.end();

      // Pipeline forwards file errors and disconnects so a deleted file or
      // canceled seek cannot leave an unhandled stream error in the main process.
      await pipeline(createReadStream(recording.videoPath, { start, end }), response);
    } catch {
      if (response.headersSent) response.destroy();
      else response.writeHead(400).end();
    }
  }
}
