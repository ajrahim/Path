import { describe, expect, it } from "vitest";
import { SessionClock } from "../src/SessionClock";
import { transitionRecordingState } from "../src/StateMachine";

describe("session clock pause", () => {
  it("freezes elapsed time while paused and excludes the pause from later reads", () => {
    let now = 1_000;
    const clock = new SessionClock({ now: () => now });

    now = 3_000;
    clock.pause();
    now = 9_000;

    expect(clock.elapsedMs()).toBe(2_000);

    clock.resume();
    now = 10_000;

    expect(clock.elapsedMs()).toBe(3_000);
  });

  it("records each resumed pause at its media offset with its duration", () => {
    let now = 1_000;
    const clock = new SessionClock({ now: () => now });

    now = 3_000;
    clock.pause();
    now = 8_000;
    clock.resume();
    now = 10_000;
    clock.pause();
    now = 11_500;
    clock.resume();
    now = 12_000;
    clock.pause();

    expect(clock.pauses()).toEqual([
      { atMs: 2_000, durationMs: 5_000 },
      { atMs: 4_000, durationMs: 1_500 },
    ]);
    expect(clock.elapsedMs()).toBe(4_500);
  });

  it("ignores repeated pauses and resumes without a matching pause", () => {
    let now = 0;
    const clock = new SessionClock({ now: () => now });

    clock.resume();
    now = 1_000;
    clock.pause();
    clock.pause();
    now = 5_000;

    expect(clock.elapsedMs()).toBe(1_000);
  });
});

describe("recording retry transition", () => {
  it("re-enters video processing from idle, ready, and failed states", () => {
    expect(transitionRecordingState("IDLE", "RETRY_PROCESSING")).toBe("PROCESSING_VIDEO");
    expect(transitionRecordingState("READY", "RETRY_PROCESSING")).toBe("PROCESSING_VIDEO");
    expect(transitionRecordingState("FAILED", "RETRY_PROCESSING")).toBe("PROCESSING_VIDEO");
  });

  it("rejects retrying while a recording session is active", () => {
    expect(() => transitionRecordingState("RECORDING", "RETRY_PROCESSING")).toThrow(
      "Invalid recording transition",
    );
    expect(() => transitionRecordingState("PAUSED", "RETRY_PROCESSING")).toThrow(
      "Invalid recording transition",
    );
  });
});
