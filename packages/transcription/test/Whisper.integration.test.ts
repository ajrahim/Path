import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { WhisperCppTranscriptProvider } from "../src";

const execFileAsync = promisify(execFile);
const testDirectory = join(tmpdir(), `path-whisper-${process.pid}`);

// Reuse verified model bytes between runs while disposing each run's generated speech files.
const modelDirectory = join(tmpdir(), "path-whisper-models");

const whisperExecutable = fileURLToPath(
  new URL(
    "../../../apps/desktop/vendor/whisper/win32-x64/Release/whisper-cli.exe",
    import.meta.url,
  ),
);

const ffmpegExecutable = fileURLToPath(
  new URL("../../../node_modules/ffmpeg-static/ffmpeg.exe", import.meta.url),
);

afterAll(async () => {
  await rm(testDirectory, { recursive: true, force: true });
});

describe.skipIf(process.platform !== "win32")("WhisperCppTranscriptProvider", () => {
  it("transcribes local speech into timestamped segments", async () => {
    await mkdir(testDirectory, { recursive: true });

    const sourcePath = join(testDirectory, "speech-source.wav");
    const audioPath = join(testDirectory, "speech.wav");
    const escapedPath = sourcePath.replaceAll("'", "''");

    // Synthesize a deterministic local fixture; no microphone or private recording is involved.
    const script = [
      "Add-Type -AssemblyName System.Speech;",
      "$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer;",
      `$speaker.SetOutputToWaveFile('${escapedPath}');`,
      "$speaker.Speak('First open settings. Now click integrations.');",
      "$speaker.Dispose();",
    ].join(" ");

    await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script]);

    // Match the mono 16 kHz PCM input used by the desktop transcription pipeline.
    await execFileAsync(ffmpegExecutable, [
      "-y",
      "-loglevel",
      "error",
      "-i",
      sourcePath,
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      audioPath,
    ]);

    const provider = new WhisperCppTranscriptProvider({
      executablePath: whisperExecutable,
      modelDirectory,
    });

    const transcript = await provider.transcribe({
      recordingId: "00000000-0000-4000-8000-000000000001",
      path: audioPath,
      mimeType: "audio/wav",
    });

    expect(transcript.segments.length).toBeGreaterThan(0);
    expect(
      transcript.segments
        .map((segment) => segment.text)
        .join(" ")
        .toLowerCase(),
    ).toMatch(/settings|integrations/);
    expect(transcript.segments.every((segment) => segment.endMs >= segment.startMs)).toBe(true);
  }, 240_000);
});
