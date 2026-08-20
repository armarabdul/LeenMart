import { QrRedemptionForm } from '@/features/vendor-order/components/QrRedemptionForm';
import { ManualFallbackForm } from '@/features/vendor-order/components/ManualFallbackForm';

/**
 * "Redeem pickup" (S4-QR, SDD §13.2; extended S4-QR-FALLBACK, SDD §13.3).
 *
 * Two independent ways to complete a pickup, both ending at the same
 * server-authoritative single-use redemption — split into their own
 * components purely to keep each one small and focused:
 *
 *  - `QrRedemptionForm`: paste the scanned token (unchanged online
 *    behaviour); while offline, it is verified locally first and queued
 *    rather than submitted, and the queue drains automatically on
 *    reconnect.
 *  - `ManualFallbackForm` ("Scanner broken?"): a 4-digit code read off the
 *    customer's screen, for when the QR itself can't be scanned or pasted at
 *    all.
 */
export const RedeemPickupPage = (): JSX.Element => (
  <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-8">
    <header className="flex flex-col gap-1">
      <h1 className="text-xl font-bold tracking-tight text-slate-900">Redeem pickup</h1>
      <p className="text-sm text-slate-600">
        Scan the customer&rsquo;s QR code, or paste its contents below, to complete the pickup.
      </p>
    </header>

    <QrRedemptionForm />

    <div className="border-t border-slate-200 pt-4">
      <ManualFallbackForm />
    </div>
  </main>
);
