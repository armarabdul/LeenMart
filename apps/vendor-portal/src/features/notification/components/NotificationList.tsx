import { useState } from 'react';
import { apiErrorMessage } from '@/shared/api/base-api';
import { useListNotificationsQuery } from '../notification.api';
import { NotificationItem } from './NotificationItem';

const Skeleton = (): JSX.Element => (
  <div className="flex flex-col gap-3">
    {Array.from({ length: 3 }, (_, index) => (
      <div key={index} className="h-20 w-full animate-pulse rounded-lg bg-slate-100" />
    ))}
  </div>
);

interface ChunkProps {
  readonly cursor: string | undefined;
  readonly isFirst: boolean;
  readonly isLast: boolean;
  readonly onLoadMore: (cursor: string) => void;
}

/**
 * One page of the keyset-paginated list.
 *
 * Each page is its own query rather than one growing array in component
 * state, so a `Notification` tag invalidation — which every mark-read fires —
 * refreshes every page already on screen instead of leaving earlier ones
 * showing a read state that is no longer true.
 */
const NotificationChunk = ({ cursor, isFirst, isLast, onLoadMore }: ChunkProps): JSX.Element => {
  const { data, isLoading, isError, error } = useListNotificationsQuery(
    cursor === undefined ? undefined : { cursor },
  );

  if (isLoading) return <Skeleton />;

  if (isError || !data) {
    return (
      <p
        role="alert"
        className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700"
      >
        {apiErrorMessage(error, 'Your notifications could not be loaded. Please try again.')}
      </p>
    );
  }

  if (isFirst && data.items.length === 0) {
    return (
      <p className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
        You have no notifications yet. New orders and order updates will appear here.
      </p>
    );
  }

  // Bound before the guard so the narrowing survives into the callback —
  // `data.nextCursor` re-widens inside a closure, and neither a cast nor a
  // `!` should stand in for a check the compiler can do properly.
  const { nextCursor } = data;

  return (
    <>
      <ul className="flex flex-col gap-3">
        {data.items.map((notification) => (
          <NotificationItem key={notification.id} notification={notification} />
        ))}
      </ul>
      {isLast && nextCursor !== null && (
        <button
          type="button"
          onClick={() => onLoadMore(nextCursor)}
          className="self-center rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Load more
        </button>
      )}
    </>
  );
};

/** The paginated list. `undefined` is the first page's cursor — the absence of one. */
export const NotificationList = (): JSX.Element => {
  const [cursors, setCursors] = useState<readonly (string | undefined)[]>([undefined]);

  return (
    <div className="flex flex-col gap-3">
      {cursors.map((cursor, index) => (
        <NotificationChunk
          key={cursor ?? 'first'}
          cursor={cursor}
          isFirst={index === 0}
          isLast={index === cursors.length - 1}
          onLoadMore={(next) => setCursors((previous) => [...previous, next])}
        />
      ))}
    </div>
  );
};
