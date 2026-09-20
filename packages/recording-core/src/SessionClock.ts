interface MonotonicTimeSource {
  now(): number;
}

const performanceTimeSource: MonotonicTimeSource = { now: () => performance.now() };

/** One monotonic origin shared by recording controls and captured activity timestamps. */
export class SessionClock {
  private readonly originMs: number;
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
      this.pausedTotalMs += this.timeSource.now() - this.pausedAtMs;
      this.pausedAtMs = null;
    }
  }

  elapsedMs(): number {
    const endMs = this.pausedAtMs ?? this.timeSource.now();

    return Math.max(0, endMs - this.originMs - this.pausedTotalMs);
  }
}
