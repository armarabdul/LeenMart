import { useEffect } from 'react';
import { startAlertTone, stopAlertTone } from './alert-tone';
import { useVendorOrderStream } from './useVendorOrderStream';

/**
 * The app-wide new-order alert (S4-SSE, FR-64, SDD §11.5) — mounted once
 * from `AppLayout`, so it persists across every authenticated page rather
 * than only an orders page, matching "whoever has the portal open".
 *
 * `role="alert"` carries an implicit `aria-live="assertive"`, appropriate
 * for a time-sensitive operational notice a screen-reader user should hear
 * immediately rather than at the next natural pause.
 */
export const VendorStreamAlert = (): JSX.Element | null => {
  const { isAlerting, acknowledge } = useVendorOrderStream();

  useEffect(() => {
    if (isAlerting) {
      startAlertTone();
    } else {
      stopAlertTone();
    }
    return () => stopAlertTone();
  }, [isAlerting]);

  if (!isAlerting) return null;

  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-between gap-4 bg-amber-500 px-4 py-3 text-white shadow-md"
    >
      <span className="font-semibold">New order received</span>
      <button
        type="button"
        onClick={acknowledge}
        aria-label="Acknowledge new order alert and stop the sound"
        className="rounded-md bg-white/20 px-3 py-1.5 text-sm font-medium hover:bg-white/30"
      >
        Acknowledge
      </button>
    </div>
  );
};
