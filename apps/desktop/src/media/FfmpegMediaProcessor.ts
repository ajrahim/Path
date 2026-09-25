import { spawn } from "node:child_process";
import { rename, rm, stat } from "node:fs/promises";
import { dirname, extname, join, parse } from "node:path";

export interface VideoMetadata {
  durationMs: number;
  hasAudio: boolean;
  createdAt: string | null;
}

export interface MediaProcessor {
  probe(inputPath: string): Promise<VideoMetadata>;
  finalize(inputPath: string, outputPath: string): Promise<void>;
  extractAudio(inputPath: string, outputPath: string): Promise<void>;
  extractThumbnail(inputPath: string, outputPath: string): Promise<void>;
}

const MEDIA_PROBE_TIMEOUT_MS = 30_000;
const MAX_PROBE_OUTPUT_CHARACTERS = 64_000;

export class FfmpegMediaProcessor implements MediaProcessor {
  constructor(private readonly executablePath: string) {}

  probe(inputPath: string): Promise<VideoMetadata> {
    return new Promise((resolve, reject) => {
      // Inspect the container and decode one frame using the FFmpeg already bundled with Path.
      const process = spawn(
        this.executablePath,
        [
          "-nostdin",
          "-hide_banner",
          "-protocol_whitelist",
          "file,pipe",
          "-i",
          inputPath,
          "-map",
          "0:v:0",
          "-frames:v",
          "1",
          "-an",
          "-f",
          "null",
          "-",
        ],
        { windowsHide: true },
      );

      let output = "";
      const timeout = setTimeout(() => {
        process.kill();
        reject(new Error("Video inspection timed out"));
      }, MEDIA_PROBE_TIMEOUT_MS);

      process.stderr.on("data", (chunk: Buffer) => {
        output = `${output}${chunk.toString()}`.slice(0, MAX_PROBE_OUTPUT_CHARACTERS);
      });
      process.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      process.on("close", (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          reject(new Error(output.trim() || `FFmpeg exited with code ${code}`));

          return;
        }

        const duration = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(output);
        const durationMs = duration
          ? Math.round(
              (Number(duration[1]) * 3_600 + Number(duration[2]) * 60 + Number(duration[3])) *
                1_000,
            )
          : 0;

        if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
          reject(new Error("The video has no valid duration"));

          return;
        }

        const creationTime = /creation_time\s*:\s*([^\r\n]+)/.exec(output)?.[1]?.trim();
        const createdAtMs = creationTime ? Date.parse(creationTime) : Number.NaN;

        resolve({
          durationMs,
          hasAudio: /Stream #0:[^\r\n]*:\s*Audio:/.test(output),
          createdAt: Number.isFinite(createdAtMs) ? new Date(createdAtMs).toISOString() : null,
        });
      });
    });
  }

  async finalize(inputPath: string, outputPath: string): Promise<void> {
    await this.writeArtifact(inputPath, outputPath, [
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-c:v",
      "libaom-av1",
      "-cpu-used",
      "8",
      "-crf",
      "34",
      "-b:v",
      "0",
      "-vf",
      "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
      "-pix_fmt",
      "yuv420p",
      "-tag:v",
      "av01",
      "-c:a",
      "libopus",
      "-movflags",
      "+faststart",
    ]);
  }

  async extractAudio(inputPath: string, outputPath: string): Promise<void> {
    // The local transcription adapter expects mono 16 kHz signed PCM audio.
    await this.writeArtifact(inputPath, outputPath, [
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
    ]);
  }

  async extractThumbnail(inputPath: string, outputPath: string): Promise<void> {
    await this.writeArtifact(inputPath, outputPath, [
      "-ss",
      "0",
      "-vframes",
      "1",
      "-vf",
      "scale=w='min(320,iw)':h='min(180,ih)':force_original_aspect_ratio=decrease",
    ]);
  }

  private async writeArtifact(
    inputPath: string,
    outputPath: string,
    outputArguments: string[],
  ): Promise<void> {
    const extension = extname(outputPath);
    const temporaryPath = join(
      dirname(outputPath),
      `${parse(outputPath).name}.processing${extension}`,
    );

    // Promote a complete artifact only; an undersized output gets one bounded retry.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await this.run(inputPath, temporaryPath, outputArguments);
      const output = await stat(temporaryPath);

      if (output.size >= 100) {
        await rm(outputPath, { force: true });
        await rename(temporaryPath, outputPath);

        return;
      }

      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    await rm(temporaryPath, { force: true });

    throw new Error("FFmpeg produced an empty artifact");
  }

  private run(inputPath: string, outputPath: string, outputArguments: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const process = spawn(
        this.executablePath,
        [
          "-nostdin",
          "-y",
          "-loglevel",
          "error",
          "-protocol_whitelist",
          "file,pipe",
          "-i",
          inputPath,
          ...outputArguments,
          outputPath,
        ],
        { windowsHide: true },
      );

      let errorOutput = "";

      // Keep enough diagnostic tail for a failure without retaining unbounded FFmpeg output.
      process.stderr.on("data", (chunk: Buffer) => {
        errorOutput = `${errorOutput}${chunk.toString()}`.slice(-20_000);
      });
      process.on("error", reject);
      process.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(errorOutput.trim() || `FFmpeg exited with code ${code}`));
        }
      });
    });
  }
}
