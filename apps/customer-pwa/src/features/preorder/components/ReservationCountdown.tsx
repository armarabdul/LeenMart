import { useEffect, useState } from 'react';

interface ReservationCountdownProps {
  readonly expiresAt: string;
  /** Called once, the instant the countdown reaches zero — the caller decides what that means (typically: refetch, since the reservation just expired server-side). */
  readonly onExpire?: () => void;
}

const formatRemaining = (remainingMs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

/**
 * The visible "MM:SS" ticking clock for a `PENDING` reservation's 10-minute
 * hold (ASM-11). Distinct from `PickupQrPanel`'s own expiry mechanism — that
 * schedules a silent background refetch at expiry and shows nothing ticking;
 * this reservation genuinely needs the customer to *see* time running out,
 * since letting it lapse loses the held quantity.
 *
 * `setInterval` at 1s, cleared on unmount or when `expiresAt` changes (a
 * fresh reservation replaces the timer rather than accumulating a second
 * one). `onExpire` fires exactly once per mount via a ref-free guard: the
 * interval clears itself the tick it observes `remaining <= 0`.
 */
export const ReservationCountdown = ({
  expiresAt,
  onExpire,
}: ReservationCountdownProps): JSX.Element => {
  const [remainingMs, setRemainingMs] = useState(() => new Date(expiresAt).getTime() - Date.now());

  useEffect(() => {
    setRemainingMs(new Date(expiresAt).getTime() - Date.now());

    const interval = setInterval(() => {
      const next = new Date(expiresAt).getTime() - Date.now();
      setRemainingMs(next);
      if (next <= 0) {
        clearInterval(interval);
        onExpire?.();
      }
    }, 1000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `onExpire` is intentionally excluded: a caller passing a fresh closure every render must not re-arm this timer every second.
  }, [expiresAt]);

  const expired = remainingMs <= 0;

  return (
    <span
      role="timer"
      aria-live={expired ? 'off' : 'polite'}
      className={
        expired
          ? 'font-mono text-sm font-semibold text-danger'
          : 'font-mono text-sm font-semibold text-text'
      }
    >
      {expired ? 'Expired' : formatRemaining(remainingMs)}
    </span>
  );
};
