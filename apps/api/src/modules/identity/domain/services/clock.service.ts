/**
 * Re-exported for discoverability within this module's own `domain/services/`
 * folder. The real interface — and its `SystemClock`/`FixedClock`
 * implementations — already lives in @leen-mart/domain-kit; every entity and
 * value object in this module already takes `now: Date` from a caller-supplied
 * `Clock`, so nothing new is defined here.
 */
export type { Clock } from '@leen-mart/domain-kit';
