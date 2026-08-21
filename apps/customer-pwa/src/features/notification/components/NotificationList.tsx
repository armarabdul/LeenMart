import { useState } from 'react';
import { Alert, Button, EmptyState, Skeleton } from '@leen-mart/ui';
import { apiErrorMessage } from '@/shared/api/base-api';
import { useListNotificationsQuery } from '../notification.api';
import { NotificationItem } from './NotificationItem';

const BellIcon = (): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-8 w-8">
    <path
      d="M18 8a6 6 0 1 0-12 0c0 4-1.5 5.5-2 6h16c-.5-.5-2-2-2-6Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path d="M10 18a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const NotificationsSkeleton = (): JSX.Element => (
  <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading your notifications">
    {Array.from({ length: 3 }, (_, index) => (
      <Skeleton key={index} shape="rect" className="h-20 w-full" />
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

  if (isLoading) return <NotificationsSkeleton />;

  if (isError || !data) {
    return (
      <Alert tone="danger">
        {apiErrorMessage(error, 'Your notifications could not be loaded. Please try again.')}
      </Alert>
    );
  }

  if (isFirst && data.items.length === 0) {
    return (
      <EmptyState
        icon={<BellIcon />}
        title="No notifications yet"
        description="Updates about your orders will appear here."
      />
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
        <Button
          type="button"
          variant="secondary"
          onClick={() => onLoadMore(nextCursor)}
          className="self-center"
        >
          Load more
        </Button>
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
