import type { ReactNode } from 'react';
import { Alert, Button, EmptyState } from '@leen-mart/ui';
import { apiErrorMessage } from '@/shared/api/base-api';

interface QueueStateViewProps {
  readonly isInitialLoad: boolean;
  readonly skeletonLabel: string;
  readonly isError: boolean;
  readonly error: unknown;
  readonly errorFallback: string;
  readonly onRetry: () => void;
  readonly isEmpty: boolean;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  readonly hasMore: boolean;
  readonly isFetchingMore: boolean;
  readonly onLoadMore: () => void;
  readonly children: ReactNode;
}

const Skeleton = ({ label }: { readonly label: string }): JSX.Element => (
  <div className="flex flex-col gap-3" aria-busy="true" aria-label={label}>
    {Array.from({ length: 4 }, (_, index) => (
      <div key={index} className="h-16 w-full animate-pulse rounded-md bg-slate-100" />
    ))}
  </div>
);

/**
 * The loading/error/empty/populated/load-more shape shared by every
 * cursor-paginated admin queue (KYC, product, review, categories) — pulled
 * out once the same branching pushed each page's own component past the
 * repository's complexity budget. `children` is the already-rendered list;
 * this component only decides which of the five states to show.
 */
export const QueueStateView = ({
  isInitialLoad,
  skeletonLabel,
  isError,
  error,
  errorFallback,
  onRetry,
  isEmpty,
  emptyTitle,
  emptyDescription,
  hasMore,
  isFetchingMore,
  onLoadMore,
  children,
}: QueueStateViewProps): JSX.Element => {
  if (isInitialLoad) return <Skeleton label={skeletonLabel} />;

  if (isError) {
    return (
      <div className="flex flex-col gap-2">
        <Alert tone="danger">{apiErrorMessage(error, errorFallback)}</Alert>
        <Button type="button" variant="secondary" onClick={onRetry} className="self-start">
          Try again
        </Button>
      </div>
    );
  }

  return (
    <>
      {isEmpty ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <>
          {children}
          {hasMore && (
            <Button
              type="button"
              variant="secondary"
              loading={isFetchingMore}
              onClick={onLoadMore}
              className="self-center"
            >
              Load more
            </Button>
          )}
        </>
      )}
    </>
  );
};
