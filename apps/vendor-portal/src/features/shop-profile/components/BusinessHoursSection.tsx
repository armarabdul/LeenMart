import { useEffect, useState } from 'react';
import type {
  SetVendorBusinessHoursRequest,
  VendorBusinessHoursResponse,
} from '@leen-mart/contracts';
import { apiErrorMessage } from '@/shared/api/base-api';
import { useGetBusinessHoursQuery, useSetBusinessHoursMutation } from '../shop-profile.api';

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

interface DraftInterval {
  readonly weekday: number;
  open: string;
  close: string;
}

interface WeekdayRowProps {
  readonly label: string;
  readonly weekday: number;
  readonly entries: readonly { readonly interval: DraftInterval; readonly index: number }[];
  readonly isHoliday: boolean;
  readonly onAdd: (weekday: number) => void;
  readonly onRemove: (index: number) => void;
  readonly onUpdate: (index: number, field: 'open' | 'close', value: string) => void;
  readonly onToggleHoliday: (weekday: number) => void;
}

/** One weekday's controls. Split out so the section itself stays within the length budget. */
const WeekdayRow = ({
  label,
  weekday,
  entries,
  isHoliday,
  onAdd,
  onRemove,
  onUpdate,
  onToggleHoliday,
}: WeekdayRowProps): JSX.Element => (
  <div className="rounded-md border border-slate-200 p-3">
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm font-medium text-slate-800">{label}</span>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1 text-xs text-slate-600">
          <input type="checkbox" checked={isHoliday} onChange={() => onToggleHoliday(weekday)} />
          Weekly holiday
        </label>
        <button
          type="button"
          onClick={() => onAdd(weekday)}
          className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
        >
          Add hours
        </button>
      </div>
    </div>

    {isHoliday && (
      <p className="mt-2 text-xs text-amber-800">
        Closed every {label} — delivery is blocked regardless of the hours below.
      </p>
    )}

    {entries.length === 0 && !isHoliday && (
      <p className="mt-2 text-xs text-slate-500">Closed — no delivery on {label}.</p>
    )}

    {entries.map(({ interval, index }) => (
      <div key={index} className="mt-2 flex items-center gap-2">
        <label className="sr-only" htmlFor={`open-${index}`}>
          {label} opening time
        </label>
        <input
          id={`open-${index}`}
          type="time"
          value={interval.open}
          onChange={(event) => onUpdate(index, 'open', event.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
        <span className="text-xs text-slate-500">to</span>
        <label className="sr-only" htmlFor={`close-${index}`}>
          {label} closing time
        </label>
        <input
          id={`close-${index}`}
          type="time"
          value={interval.close}
          onChange={(event) => onUpdate(index, 'close', event.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
        <button
          type="button"
          onClick={() => onRemove(index)}
          className="text-xs text-red-700 hover:underline"
        >
          Remove
        </button>
      </div>
    ))}
  </div>
);

/**
 * The draft as the wire wants it, or `null` when any interval is unusable.
 *
 * Validated here so the vendor sees which rule they broke rather than a bare
 * 400 — the server still validates independently, this only saves a round trip.
 */
const buildBody = (
  intervals: readonly DraftInterval[],
  holidays: readonly number[],
  closureDates: string,
): SetVendorBusinessHoursRequest | null => {
  const parsed: { weekday: number; openMinute: number; closeMinute: number }[] = [];
  for (const interval of intervals) {
    const openMinute = toMinute(interval.open);
    const closeMinute = toMinute(interval.close);
    if (openMinute === null || closeMinute === null || openMinute >= closeMinute) return null;
    parsed.push({ weekday: interval.weekday, openMinute, closeMinute });
  }

  return {
    intervals: parsed,
    closures: [
      ...holidays.map((weekday) => ({ weekday, date: null })),
      ...closureDates
        .split(/[\s,]+/)
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .map((date) => ({ weekday: null, date })),
    ],
  };
};

interface HoursDraft {
  readonly intervals: readonly DraftInterval[];
  readonly holidays: readonly number[];
  readonly closureDates: string;
  readonly setClosureDates: (value: string) => void;
  readonly addInterval: (weekday: number) => void;
  readonly removeInterval: (index: number) => void;
  readonly updateInterval: (index: number, field: 'open' | 'close', value: string) => void;
  readonly toggleHoliday: (weekday: number) => void;
  readonly build: () => SetVendorBusinessHoursRequest | null;
}

/**
 * The editable copy of the vendor's schedule, seeded from the server's.
 *
 * Split out of the section itself so neither exceeds this repository's
 * function-length budget. `onDirty` fires before every mutation, which is what
 * clears a stale "saved" notice the moment the vendor edits again.
 */
const useHoursDraft = (
  data: VendorBusinessHoursResponse | undefined,
  onDirty: () => void,
): HoursDraft => {
  const [intervals, setIntervals] = useState<readonly DraftInterval[]>([]);
  const [holidays, setHolidays] = useState<readonly number[]>([]);
  const [closureDates, setClosureDates] = useState('');

  useEffect(() => {
    if (!data) return;
    setIntervals(
      data.intervals.map((interval) => ({
        weekday: interval.weekday,
        open: toClock(interval.openMinute),
        close: toClock(interval.closeMinute),
      })),
    );
    setHolidays(data.closures.flatMap((c) => (c.weekday === null ? [] : [c.weekday])));
    setClosureDates(data.closures.flatMap((c) => (c.date === null ? [] : [c.date])).join('\n'));
  }, [data]);

  return {
    intervals,
    holidays,
    closureDates,
    setClosureDates: (value) => {
      onDirty();
      setClosureDates(value);
    },
    addInterval: (weekday) => {
      onDirty();
      setIntervals((current) => [...current, { weekday, open: '09:00', close: '18:00' }]);
    },
    removeInterval: (index) => {
      onDirty();
      setIntervals((current) => current.filter((_, i) => i !== index));
    },
    updateInterval: (index, field, value) => {
      onDirty();
      setIntervals((current) =>
        current.map((interval, i) => (i === index ? { ...interval, [field]: value } : interval)),
      );
    },
    toggleHoliday: (weekday) => {
      onDirty();
      setHolidays((current) =>
        current.includes(weekday) ? current.filter((d) => d !== weekday) : [...current, weekday],
      );
    },
    build: () => buildBody(intervals, holidays, closureDates),
  };
};

/**
 * Business hours (S4-HOURS).
 *
 * Lives on the shop-profile page rather than a page of its own — it is another
 * self-service vendor setting, and S4-ADDR established this page as where
 * those live.
 *
 * The empty state is stated explicitly rather than left to inference: a vendor
 * with no configured hours currently accepts delivery at any time (locked
 * decision H4-A), and a blank schedule could reasonably read as the opposite.
 *
 * All times are IST — the platform is single-region (ASM-01) — and a day with
 * no hours is a day the vendor does not deliver. Pickup is never affected.
 */
export const BusinessHoursSection = (): JSX.Element => {
  const { data, isLoading, isError, error } = useGetBusinessHoursQuery();
  const [setBusinessHours, { isLoading: isSaving, error: saveError }] =
    useSetBusinessHoursMutation();

  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  const [invalid, setInvalid] = useState(false);

  const dirty = (): void => {
    setSaved(false);
    setFailed(false);
    setInvalid(false);
  };

  const draft = useHoursDraft(data, dirty);

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    dirty();

    const body = draft.build();
    if (!body) {
      setInvalid(true);
      return;
    }

    try {
      await setBusinessHours(body).unwrap();
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
        {apiErrorMessage(error, 'Your business hours could not be loaded.')}
      </p>
    );
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4"
    >
      {!data.configured && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          You have not set any business hours, so you currently accept delivery orders at any time.
          Adding hours below will limit delivery to those times only.
        </p>
      )}
      <p className="text-sm text-slate-600">
        All times are IST. A day with no hours is a day you do not deliver. Pickup orders are never
        affected by these hours.
      </p>

      <div className="flex flex-col gap-3">
        {WEEKDAYS.map((label, weekday) => (
          <WeekdayRow
            key={label}
            label={label}
            weekday={weekday}
            entries={draft.intervals
              .map((interval, index) => ({ interval, index }))
              .filter((entry) => entry.interval.weekday === weekday)}
            isHoliday={draft.holidays.includes(weekday)}
            onAdd={draft.addInterval}
            onRemove={draft.removeInterval}
            onUpdate={draft.updateInterval}
            onToggleHoliday={draft.toggleHoliday}
          />
        ))}
      </div>

      <label className="flex flex-col gap-1 text-sm text-slate-700">
        <span>Closure dates</span>
        <span className="text-xs text-slate-500">
          One YYYY-MM-DD per line, for one-off closures such as a public holiday.
        </span>
        <textarea
          name="closureDates"
          value={draft.closureDates}
          onChange={(event) => draft.setClosureDates(event.target.value)}
          rows={3}
          className="rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
        />
      </label>

      {invalid && (
        <p role="alert" className="text-sm text-red-700">
          Each opening time must be a valid time before its closing time. Hours cannot run past
          midnight.
        </p>
      )}
      {failed && (
        <p role="alert" className="text-sm text-red-700">
          {apiErrorMessage(saveError, 'Your business hours could not be saved.')}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-green-700">
          Business hours saved.
        </p>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isSaving}
          className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {isSaving ? 'Saving…' : 'Save business hours'}
        </button>
      </div>
    </form>
  );
};
