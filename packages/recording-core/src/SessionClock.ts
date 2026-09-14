interface MonotonicTimeSource {
  now(): number;
}

const performanceTimeSource: MonotonicTimeSource = { now: () => performance.now() };

/** One monotonic origin shared by recording controls and captured activity timestamps. */
export class SessionClock {
  private readonly originMs: number;

  constructor(private readonly timeSource = performanceTimeSource) {
    this.originMs = timeSource.now();
  }

  elapsedMs(): number {
    return Math.max(0, this.timeSource.now() - this.originMs);
  }
}
