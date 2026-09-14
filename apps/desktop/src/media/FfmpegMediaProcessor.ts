import { spawn } from "node:child_process";
import { rename, rm, stat } from "node:fs/promises";
import { dirname, extname, join, parse } from "node:path";

export interface MediaProcessor {
  finalize(inputPath: string, outputPath: string): Promise<void>;
  extractAudio(inputPath: string, outputPath: string): Promise<void>;
}

export class FfmpegMediaProcessor implements MediaProcessor {
  constructor(private readonly executablePath: string) {}

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

      if (output.size >= 1_024) {
        await rm(outputPath, { force: true });
        await rename(temporaryPath, outputPath);

        return;
      }

      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    await rm(temporaryPath, { force: true });

    throw new Error("FFmpeg produced an empty video");
  }

  private run(inputPath: string, outputPath: string, outputArguments: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const process = spawn(
        this.executablePath,
        ["-y", "-loglevel", "error", "-i", inputPath, ...outputArguments, outputPath],
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
