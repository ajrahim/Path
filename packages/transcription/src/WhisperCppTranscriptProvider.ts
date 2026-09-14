import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { basename, dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import type { TranscriptSegment } from "@path/shared";
import type { AudioFile, Transcript, TranscriptProvider } from "./Provider";

// Pin both size and digest so a partial or substituted download cannot become the active model.
const TINY_EN_MODEL = {
  filename: "ggml-tiny.en.bin",
  url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin?download=true",
  size: 77_704_715,
  sha256: "921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f",
} as const;

interface WhisperJsonSegment {
  text?: unknown;
  speech?: unknown;
  offsets?: { from?: unknown; to?: unknown };
  timestamps?: { from?: unknown; to?: unknown };
}

interface WhisperJsonOutput {
  result?: { language?: unknown };
  language?: unknown;
  transcription?: unknown;
  segments?: unknown;
}

/** The desktop supplies the native runtime path and the durable model-cache directory. */
export interface WhisperCppProviderOptions {
  executablePath: string;
  modelDirectory: string;
}

/** Runs local English transcription and normalizes whisper.cpp JSON into shared segments. */
export class WhisperCppTranscriptProvider implements TranscriptProvider {
  readonly id = "whisper-cpp-tiny-en";
  readonly displayName = "Whisper tiny.en (local)";
  readonly processingLocation = "local" as const;

  private modelPromise: Promise<string> | null = null;

  constructor(private readonly options: WhisperCppProviderOptions) {}

  async transcribe(input: AudioFile): Promise<Transcript> {
    const modelPath = await this.getModelPath();
    const outputBase = join(dirname(input.path), "transcript");

    await this.runWhisper(input.path, modelPath, outputBase);

    const output = JSON.parse(await readFile(`${outputBase}.json`, "utf8")) as WhisperJsonOutput;

    // Supported CLI versions use different collection names for the same transcript output.
    const rawSegments = Array.isArray(output.transcription)
      ? output.transcription
      : Array.isArray(output.segments)
        ? output.segments
        : [];

    const segments = rawSegments
      .map((segment) => this.toSegment(input.recordingId, segment))
      .filter((segment): segment is TranscriptSegment => segment !== null);

    const language =
      typeof output.result?.language === "string"
        ? output.result.language
        : typeof output.language === "string"
          ? output.language
          : "en";

    return { language, segments };
  }

  private getModelPath(): Promise<string> {
    // Concurrent callers share model preparation; a failed attempt may be retried later.
    if (!this.modelPromise) {
      this.modelPromise = this.ensureModel().catch((error: unknown) => {
        this.modelPromise = null;

        throw error;
      });
    }

    return this.modelPromise;
  }

  private async ensureModel(): Promise<string> {
    await mkdir(this.options.modelDirectory, { recursive: true });

    const modelPath = join(this.options.modelDirectory, TINY_EN_MODEL.filename);

    if (await this.isValidModel(modelPath)) return modelPath;

    const temporaryPath = `${modelPath}.download`;

    await rm(temporaryPath, { force: true });

    const response = await fetch(TINY_EN_MODEL.url, { headers: { "Accept-Encoding": "identity" } });

    if (!response.ok || !response.body) {
      throw new Error(`Unable to download Whisper model: ${response.status}`);
    }

    await pipeline(Readable.fromWeb(response.body as never), createWriteStream(temporaryPath));

    if (!(await this.isValidModel(temporaryPath))) {
      const metadata = await this.modelMetadata(temporaryPath);

      await rm(temporaryPath, { force: true });

      throw new Error(
        `Whisper model checksum verification failed: ${metadata.size} bytes, sha256 ${metadata.sha256}`,
      );
    }

    // Publish the candidate only after full-file validation has succeeded.
    await rm(modelPath, { force: true });
    await rename(temporaryPath, modelPath);

    return modelPath;
  }

  private async isValidModel(path: string): Promise<boolean> {
    try {
      const metadata = await this.modelMetadata(path);

      return metadata.size === TINY_EN_MODEL.size && metadata.sha256 === TINY_EN_MODEL.sha256;
    } catch {
      // Missing or unreadable cache files are not usable models and can be downloaded again.
      return false;
    }
  }

  private async modelMetadata(path: string): Promise<{ size: number; sha256: string }> {
    const file = await stat(path);
    const digest = createHash("sha256");

    // Hash as a stream rather than retaining the entire model in memory.
    for await (const chunk of createReadStream(path)) {
      digest.update(chunk);
    }

    return { size: file.size, sha256: digest.digest("hex") };
  }

  private runWhisper(audioPath: string, modelPath: string, outputBase: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const process = spawn(
        this.options.executablePath,
        [
          "--model",
          modelPath,
          "--file",
          audioPath,
          "--language",
          "en",
          "--output-json",
          "--output-file",
          outputBase,
          "--threads",
          String(Math.max(1, Math.min(8, availableParallelism() - 1))),
          "--no-gpu",
          "--no-prints",
        ],
        { cwd: dirname(this.options.executablePath), windowsHide: true },
      );

      // Preserve a bounded diagnostic tail without buffering all native process output.
      let errorOutput = "";

      process.stderr.on("data", (chunk: Buffer) => {
        errorOutput = `${errorOutput}${chunk.toString()}`.slice(-20_000);
      });

      process.on("error", reject);
      process.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(
              errorOutput.trim() ||
                `${basename(this.options.executablePath)} exited with code ${code}`,
            ),
          );
        }
      });
    });
  }

  private toSegment(recordingId: string, raw: unknown): TranscriptSegment | null {
    if (!raw || typeof raw !== "object") return null;

    const segment = raw as WhisperJsonSegment;
    const text =
      typeof segment.text === "string"
        ? segment.text.trim()
        : typeof segment.speech === "string"
          ? segment.speech.trim()
          : "";

    if (!text) return null;

    const startMs = timeToMs(segment.offsets?.from ?? segment.timestamps?.from);
    const endMs = timeToMs(segment.offsets?.to ?? segment.timestamps?.to);

    if (startMs === null || endMs === null || endMs < startMs) return null;

    return { id: randomUUID(), recordingId, startMs, endMs, text };
  }
}

/** Whisper emits either millisecond offsets or clock strings with comma/dot milliseconds. */
function timeToMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;

  const match = value.match(/^(\d{2}):(\d{2}):(\d{2})[.,](\d{3})$/);

  if (!match) return null;

  const [, hours, minutes, seconds, milliseconds] = match;

  return (
    Number(hours) * 3_600_000 +
    Number(minutes) * 60_000 +
    Number(seconds) * 1_000 +
    Number(milliseconds)
  );
}
