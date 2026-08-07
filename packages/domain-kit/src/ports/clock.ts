/**
 * Time as an injected dependency.
 *
 * Calling `new Date()` inside domain code makes anything time-dependent
 * untestable — which matters here because preorder windows, QR expiry and slot
 * capacity are all time-driven. The base ESLint config bans bare `new Date()`
 * to keep this honest.
 */
export interface Clock {
  now(): Date;
  nowMs(): number;
}

export class SystemClock implements Clock {
  now(): Date {
    // The one legitimate call site: this class exists specifically to wrap
    // the real system clock, so the port it implements can be injected
    // everywhere else instead (SDD 24.3).
    // eslint-disable-next-line no-restricted-syntax
    return new Date();
  }

  nowMs(): number {
    return Date.now();
  }
}

/** Deterministic clock for tests. */
export class FixedClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return new Date(this.current.getTime());
  }

  nowMs(): number {
    return this.current.getTime();
  }

  set(date: Date): void {
    this.current = date;
  }

  advanceMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
