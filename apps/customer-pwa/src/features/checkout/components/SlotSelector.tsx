import type { AvailableSlotDto, SlotAvailabilityResponse } from '@leen-mart/contracts';
import { Alert, Button } from '@leen-mart/ui';
import { apiErrorMessage } from '@/shared/api/base-api';

/** `540` → `09:00`. Minutes since IST midnight is the wire format; the customer reads clock time. */
const toClock = (minute: number): string =>
  `${`${Math.floor(minute / 60)}`.padStart(2, '0')}:${`${minute % 60}`.padStart(2, '0')}`;

/** `2026-08-19` → `Wed 19 Aug`, computed without a timezone so the label matches the IST date exactly. */
const toDayLabel = (isoDate: string): string => {
  const day = new Date(`${isoDate}T00:00:00Z`);
  return day.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
};

const slotLabel = (slot: AvailableSlotDto): string =>
  `${toDayLabel(slot.date)}, ${toClock(slot.startMinute)}–${toClock(slot.endMinute)}`;

export interface SlotChoice {
  readonly vendorId: string;
  readonly date: string;
  readonly startMinute: number;
}

interface SlotSelectorProps {
  readonly availability: SlotAvailabilityResponse | undefined;
  /** Phase I. True when the availability request itself failed — distinct from "no vendor offers windows". */
  readonly isError?: boolean;
  readonly error?: unknown;
  /** Omitted only in contexts with no way to retry; when present, offered alongside the error. */
  readonly onRetry?: () => void;
  readonly selections: readonly SlotChoice[];
  readonly onSelect: (choice: SlotChoice) => void;
}

const VendorSlots = ({
  vendorId,
  shopName,
  slots,
  selected,
  onSelect,
}: {
  readonly vendorId: string;
  readonly shopName: string | null;
  readonly slots: readonly AvailableSlotDto[];
  readonly selected: SlotChoice | undefined;
  readonly onSelect: (choice: SlotChoice) => void;
}): JSX.Element => (
  <li className="rounded-lg border border-border bg-surface p-4">
    <p className="text-sm font-medium text-text">{shopName ?? 'This seller'}</p>
    <ul className="mt-2 flex flex-col gap-2">
      {slots.map((slot) => {
        const full = slot.remaining === 0;
        const isSelected =
          selected?.date === slot.date && selected.startMinute === slot.startMinute;
        return (
          <li key={`${slot.date}-${slot.startMinute}`}>
            <label
              className={`flex min-h-11 cursor-pointer items-center gap-2 text-sm ${full ? 'cursor-not-allowed text-text-faint' : 'text-text'}`}
            >
              <input
                type="radio"
                name={`slot-${vendorId}`}
                checked={isSelected}
                disabled={full}
                onChange={() =>
                  onSelect({ vendorId, date: slot.date, startMinute: slot.startMinute })
                }
                className="h-4 w-4 rounded-full accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed"
              />
              <span>{slotLabel(slot)}</span>
              {/* A count, not a promise: the window may fill before this order
                  is placed, and the server refuses rather than substituting. */}
              <span className="text-xs text-text-muted">
                {full ? 'Full' : `${slot.remaining} left`}
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  </li>
);

/**
 * Per-vendor fulfilment window choice (S4-SLOTS, locked decisions S1–S4).
 *
 * One choice per vendor, never one for the whole order — the same reasoning
 * `FulfilmentModeSelector` gives: a multi-vendor cart has one sub-order per
 * shop, and each is fulfilled on its own schedule.
 *
 * Shown for `DELIVERY` and `PICKUP` alike (locked decision S4): business hours
 * are delivery-only, but slot capacity is not.
 *
 * A vendor with no windows is not rendered at all — they take orders without a
 * slot, so there is nothing to choose. When no vendor in the cart offers
 * windows, the whole section disappears rather than showing an empty box.
 *
 * The remaining counts here are **display only**. `PlaceOrderUseCase`
 * re-resolves the chosen window against the vendor's own template and takes
 * capacity with an atomic conditional update, so nothing this component shows
 * can widen a window, inflate a capacity or reserve anything.
 */
export const SlotSelector = ({
  availability,
  isError = false,
  error,
  onRetry,
  selections,
  onSelect,
}: SlotSelectorProps): JSX.Element | null => {
  // Phase I: a failed fetch is not the same fact as "no seller offers
  // windows" (the `vendors.length === 0` branch below) — the customer must
  // see the two differently, since the first is recoverable and the second
  // isn't.
  if (isError) {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">Time slot</h2>
        <Alert tone="danger" title="Time slots couldn’t be loaded">
          {apiErrorMessage(error, 'We could not load available time slots. Please try again.')}
        </Alert>
        {onRetry && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onRetry}
            className="self-start"
          >
            Try again
          </Button>
        )}
      </section>
    );
  }

  const vendors = (availability?.vendors ?? []).filter((vendor) => vendor.slots.length > 0);
  if (vendors.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">Time slot</h2>
      <p className="text-xs text-text-muted">
        All times are IST. Choose one slot per seller — it applies whether you are having the order
        delivered or collecting it.
      </p>
      <ul className="flex flex-col gap-3">
        {vendors.map((vendor) => (
          <VendorSlots
            key={vendor.vendorId}
            vendorId={vendor.vendorId}
            shopName={vendor.shopName}
            slots={vendor.slots}
            selected={selections.find((choice) => choice.vendorId === vendor.vendorId)}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </section>
  );
};
