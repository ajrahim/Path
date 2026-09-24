interface MonotonicTimeSource {
  now(): number;
}

/** Media offset where the clock paused and how long it stayed paused, in milliseconds. */
interface ClockPause {
  atMs: number;
  durationMs: number;
}

const performanceTimeSource: MonotonicTimeSource = { now: () => performance.now() };

/** One monotonic origin shared by recording controls and captured activity timestamps. */
export class SessionClock {
  private readonly originMs: number;
  private readonly completedPauses: ClockPause[] = [];
  private pausedTotalMs = 0;
  private pausedAtMs: number | null = null;

  constructor(private readonly timeSource = performanceTimeSource) {
    this.originMs = timeSource.now();
  }

  pause(): void {
    if (this.pausedAtMs === null) this.pausedAtMs = this.timeSource.now();
  }

  resume(): void {
    if (this.pausedAtMs !== null) {
      const atMs = Math.max(0, this.pausedAtMs - this.originMs - this.pausedTotalMs);
      const durationMs = this.timeSource.now() - this.pausedAtMs;

      this.completedPauses.push({ atMs: Math.round(atMs), durationMs: Math.round(durationMs) });
      this.pausedTotalMs += durationMs;
      this.pausedAtMs = null;
    }
  }

  elapsedMs(): number {
    const endMs = this.pausedAtMs ?? this.timeSource.now();

    return Math.max(0, endMs - this.originMs - this.pausedTotalMs);
  }

  /** Resumed pauses in chronological order; a pause still open when capture stops ends the media. */
  pauses(): ClockPause[] {
    return this.completedPauses.map((pause) => ({ ...pause }));
  }
}
