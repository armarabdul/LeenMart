import { useState } from 'react';
import { apiErrorMessage } from '@/shared/api/base-api';
import { ORDER_STATUS_LABEL } from '@/shared/lib/order-status-label';
import { useCompletePickupManuallyMutation } from '../vendor-order.api';

const MANUAL_CODE_PATTERN = /^\d{4}$/;

/**
 * The scanner-broken fallback (S4-QR-FALLBACK, SDD §13.3) — collapsed behind
 * a toggle so it stays clearly secondary to, and visually distinct from, the
 * QR path in `QrRedemptionForm`. Addressed by sub-order id, not a scanned
 * token: the vendor selects the order from their own dashboard rather than
 * presenting a credential, matching the backend route's own `:id` shape.
 */
export const ManualFallbackForm = (): JSX.Element => {
  const [expanded, setExpanded] = useState(false);
  const [subOrderId, setSubOrderId] = useState('');
  const [code, setCode] = useState('');
  const [completePickupManually, manualState] = useCompletePickupManuallyMutation();

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (manualState.data) manualState.reset();
    try {
      await completePickupManually({ subOrderId: subOrderId.trim(), body: { code } }).unwrap();
      setCode('');
    } catch {
      // The mutation's own `error` state renders the message below.
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="text-sm font-medium text-brand-700 underline hover:text-brand-600"
      >
        {expanded ? 'Hide manual fallback' : 'Scanner broken?'}
      </button>

      {expanded && (
        <form
          onSubmit={(event) => void handleSubmit(event)}
          className="mt-3 flex flex-col gap-3 rounded-md border border-slate-200 bg-slate-50 p-4"
        >
          <p className="text-sm text-slate-600">
            Ask the customer to read out the 4-digit code shown on their pickup screen.
          </p>
          <label htmlFor="manual-suborder-id" className="text-sm font-medium text-slate-700">
            Order (sub-order id)
          </label>
          <input
            id="manual-suborder-id"
            value={subOrderId}
            onChange={(event) => {
              setSubOrderId(event.target.value);
              if (manualState.data) manualState.reset();
            }}
            className="w-full rounded-md border border-slate-300 p-2 font-mono text-xs"
            placeholder="Sub-order id"
          />
          <label htmlFor="manual-code" className="text-sm font-medium text-slate-700">
            4-digit code
          </label>
          <input
            id="manual-code"
            value={code}
            onChange={(event) => {
              setCode(event.target.value.replace(/\D/g, '').slice(0, 4));
              if (manualState.data) manualState.reset();
            }}
            inputMode="numeric"
            pattern="\d{4}"
            maxLength={4}
            className="w-32 rounded-md border border-slate-300 p-2 text-center font-mono text-lg tracking-widest"
            placeholder="0000"
            autoComplete="off"
          />
          <button
            type="submit"
            disabled={
              manualState.isLoading ||
              subOrderId.trim().length === 0 ||
              !MANUAL_CODE_PATTERN.test(code)
            }
            className="self-end rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {manualState.isLoading ? 'Completing…' : 'Complete pickup manually'}
          </button>

          {manualState.error && (
            <p role="alert" className="text-sm text-red-700">
              {apiErrorMessage(manualState.error, 'This pickup could not be completed.')}
            </p>
          )}
          {manualState.data && (
            <div role="status" className="text-sm text-emerald-800">
              <p className="font-medium">Pickup completed (manual fallback)</p>
              <p className="mt-1">
                Order {manualState.data.id} is now {ORDER_STATUS_LABEL[manualState.data.status]}.
              </p>
            </div>
          )}
        </form>
      )}
    </>
  );
};
