import { useEffect, useState } from 'react';
import type {
  SetVendorDeliverySlotsRequest,
  SlotBookingDto,
  VendorDeliverySlotsResponse,
} from '@leen-mart/contracts';
import { apiErrorMessage } from '@/shared/api/base-api';
import { useGetDeliverySlotsQuery, useSetDeliverySlotsMutation } from '../shop-profile.api';

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/** `540` → `09:00`. Minutes since IST midnight is the wire format; the vendor types clock time. */
const toClock = (minute: number): string =>
  `${`${Math.floor(minute / 60)}`.padStart(2, '0')}:${`${minute % 60}`.padStart(2, '0')}`;

/** `09:00` → `540`. Returns `null` for anything that is not a valid clock time. */
const toMinute = (clock: string): number | null => {
  const match = /^(\d{2}):(\d{2})$/.exec(clock.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59 || hours * 60 + minutes > 1440) return null;
  return hours * 60 + minutes;
};

interface DraftSlot {
  readonly weekday: number;
  start: string;
  end: string;
  capacity: string;
}

interface WeekdayRowProps {
  readonly label: string;
  readonly weekday: number;
  readonly entries: readonly { readonly slot: DraftSlot; readonly index: number }[];
  readonly bookedFor: (weekday: number, startMinute: number) => number;
  readonly onAdd: (weekday: number) => void;
  readonly onRemove: (index: number) => void;
  readonly onUpdate: (index: number, field: 'start' | 'end' | 'capacity', value: string) => void;
}

/** One weekday's windows. Split out so the section itself stays within the length budget. */
const WeekdayRow = ({
  label,
  weekday,
  entries,
  bookedFor,
  onAdd,
  onRemove,
  onUpdate,
}: WeekdayRowProps): JSX.Element => (
  <div className="rounded-md border border-slate-200 p-3">
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm font-medium text-slate-800">{label}</span>
      <button
        type="button"
        onClick={() => onAdd(weekday)}
        className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
      >
        Add slot
      </button>
    </div>

    {entries.length === 0 && (
      <p className="mt-2 text-xs text-slate-500">No slots offered on {label}.</p>
    )}

    {entries.map(({ slot, index }) => {
      const startMinute = toMinute(slot.start);
      const booked = startMinute === null ? 0 : bookedFor(weekday, startMinute);
      return (
        <div key={index} className="mt-2 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`slot-start-${index}`}>
            {label} slot start
          </label>
          <input
            id={`slot-start-${index}`}
            type="time"
            value={slot.start}
            onChange={(event) => onUpdate(index, 'start', event.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
          <span className="text-xs text-slate-500">to</span>
          <label className="sr-only" htmlFor={`slot-end-${index}`}>
            {label} slot end
          </label>
          <input
            id={`slot-end-${index}`}
            type="time"
            value={slot.end}
            onChange={(event) => onUpdate(index, 'end', event.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
          <label className="text-xs text-slate-600" htmlFor={`slot-capacity-${index}`}>
            Orders
          </label>
          <input
            id={`slot-capacity-${index}`}
            type="number"
            min={1}
            value={slot.capacity}
            onChange={(event) => onUpdate(index, 'capacity', event.target.value)}
            className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
          {booked > 0 && (
            <span className="text-xs text-slate-500">{booked} booked in the next 7 days</span>
          )}
          <button
            type="button"
            onClick={() => onRemove(index)}
            className="text-xs text-red-700 hover:underline"
          >
            Remove
          </button>
        </div>
      );
    })}
  </div>
);

/**
 * The draft as the wire wants it, or `null` when any window is unusable.
 *
 * Validated here so the vendor sees which rule they broke rather than a bare
 * 400 — the server still validates independently, this only saves a round trip.
 */
const buildBody = (slots: readonly DraftSlot[]): SetVendorDeliverySlotsRequest | null => {
  const parsed: { weekday: number; startMinute: number; endMinute: number; capacity: number }[] =
    [];
  for (const slot of slots) {
    const startMinute = toMinute(slot.start);
    const endMinute = toMinute(slot.end);
    const capacity = Number(slot.capacity);
    if (startMinute === null || endMinute === null || startMinute >= endMinute) return null;
    if (!Number.isInteger(capacity) || capacity < 1) return null;
    parsed.push({ weekday: slot.weekday, startMinute, endMinute, capacity });
  }
  return { slots: parsed };
};

interface SlotsDraft {
  readonly slots: readonly DraftSlot[];
  readonly add: (weekday: number) => void;
  readonly remove: (index: number) => void;
  readonly update: (index: number, field: 'start' | 'end' | 'capacity', value: string) => void;
  readonly build: () => SetVendorDeliverySlotsRequest | null;
}

/**
 * The editable copy of the vendor's offer, seeded from the server's.
 *
 * Split out of the section itself so neither exceeds this repository's
 * function-length budget — the same shape `BusinessHoursSection` uses.
 */
const useSlotsDraft = (
  data: VendorDeliverySlotsResponse | undefined,
  onDirty: () => void,
): SlotsDraft => {
  const [slots, setSlots] = useState<readonly DraftSlot[]>([]);

  useEffect(() => {
    if (!data) return;
    setSlots(
      data.slots.map((slot) => ({
        weekday: slot.weekday,
        start: toClock(slot.startMinute),
        end: toClock(slot.endMinute),
        capacity: String(slot.capacity),
      })),
    );
  }, [data]);

  return {
    slots,
    add: (weekday) => {
      onDirty();
      setSlots((current) => [...current, { weekday, start: '09:00', end: '11:00', capacity: '5' }]);
    },
    remove: (index) => {
      onDirty();
      setSlots((current) => current.filter((_, i) => i !== index));
    },
    update: (index, field, value) => {
      onDirty();
      setSlots((current) =>
        current.map((slot, i) => (i === index ? { ...slot, [field]: value } : slot)),
      );
    },
    build: () => buildBody(slots),
  };
};

/** How many sub-orders are already booked into a window over the coming week. */
const bookingsLookup =
  (bookings: readonly SlotBookingDto[]) =>
  (weekday: number, startMinute: number): number =>
    bookings
      .filter(
        (booking) =>
          booking.startMinute === startMinute &&
          new Date(`${booking.date}T00:00:00Z`).getUTCDay() === weekday,
      )
      .reduce((total, booking) => total + booking.booked, 0);

/**
 * Delivery and pickup slots (S4-SLOTS).
 *
 * Lives on the shop-profile page rather than a page of its own — it is another
 * self-service vendor setting, and S4-ADDR established this page as where
 * those live.
 *
 * The empty state is stated explicitly rather than left to inference: a vendor
 * with no slots takes orders without one, and a blank list could reasonably
 * read as the opposite.
 *
 * Capacity counts **sub-orders**, one per order per shop — not items, not
 * weight (locked decision S2). Editing the offer never disturbs bookings
 * already taken.
 */
export const DeliverySlotsSection = (): JSX.Element => {
  const { data, isLoading, isError, error } = useGetDeliverySlotsQuery();
  const [setDeliverySlots, { isLoading: isSaving, error: saveError }] =
    useSetDeliverySlotsMutation();

  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  const [invalid, setInvalid] = useState(false);

  const dirty = (): void => {
    setSaved(false);
    setFailed(false);
    setInvalid(false);
  };

  const draft = useSlotsDraft(data, dirty);

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    dirty();

    const body = draft.build();
    if (!body) {
      setInvalid(true);
      return;
    }

    try {
      await setDeliverySlots(body).unwrap();
      setSaved(true);
    } catch {
      setFailed(true);
    }
  };

  if (isLoading) {
    return <div className="h-20 w-full animate-pulse rounded-md bg-slate-100" />;
  }

  if (isError || !data) {
    return (
      <p
        role="alert"
        className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700"
      >
        {apiErrorMessage(error, 'Your slots could not be loaded.')}
      </p>
    );
  }

  const bookedFor = bookingsLookup(data.bookings);

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4"
    >
      {!data.configured && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          You offer no time slots, so customers order from you without choosing one. Adding slots
          below will require customers to pick one, and will limit how many orders each slot takes.
        </p>
      )}
      <p className="text-sm text-slate-600">
        All times are IST. Each slot&apos;s number is how many orders you will accept in that window
        — one order from one customer counts as one, however many items it contains. Slots apply to
        both delivery and pickup.
      </p>

      <div className="flex flex-col gap-3">
        {WEEKDAYS.map((label, weekday) => (
          <WeekdayRow
            key={label}
            label={label}
            weekday={weekday}
            entries={draft.slots
              .map((slot, index) => ({ slot, index }))
              .filter((entry) => entry.slot.weekday === weekday)}
            bookedFor={bookedFor}
            onAdd={draft.add}
            onRemove={draft.remove}
            onUpdate={draft.update}
          />
        ))}
      </div>

      {invalid && (
        <p role="alert" className="text-sm text-red-700">
          Each slot must start before it ends, must not run past midnight, and must accept at least
          one order.
        </p>
      )}
      {failed && (
        <p role="alert" className="text-sm text-red-700">
          {apiErrorMessage(saveError, 'Your slots could not be saved.')}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-green-700">
          Slots saved.
        </p>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isSaving}
          className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {isSaving ? 'Saving…' : 'Save slots'}
        </button>
      </div>
    </form>
  );
};
