import { Link } from 'react-router-dom';
import type { OrderSummaryResponse } from '@leen-mart/contracts';
import { Alert, Card, EmptyState, Skeleton, StatusBadge } from '@leen-mart/ui';
import { apiErrorMessage } from '@/shared/api/base-api';
import { formatMoney } from '@/shared/lib/format-money';
import { ORDER_STATUS_LABEL } from '@/shared/lib/order-status-label';
import { ORDER_STATUS_TONE } from '@/shared/lib/order-status-tone';
import { PageContainer } from '@/components/PageContainer';
import { useListOrdersQuery } from '@/features/checkout/checkout.api';

const OrdersIcon = (): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-8 w-8 text-text-faint">
    <path
      d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5v-7Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path
      d="M4 8.5 12 13l8-4.5M12 13v7"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  </svg>
);

const OrderHistorySkeleton = (): JSX.Element => (
  <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading your orders">
    {Array.from({ length: 3 }, (_, index) => (
      <Skeleton key={index} shape="rect" className="h-20 w-full" />
    ))}
  </div>
);

const formatOrderDate = (isoDateTime: string): string =>
  new Date(isoDateTime).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

const OrderSummaryRow = ({ order }: { readonly order: OrderSummaryResponse }): JSX.Element => (
  <li>
    <Link to={`/orders/${order.id}`} className="block">
      <Card interactive className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate font-mono text-xs text-text-faint">{order.id}</span>
          <span className="text-sm text-text-muted">{formatOrderDate(order.createdAt)}</span>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <StatusBadge
            tone={ORDER_STATUS_TONE[order.status]}
            label={ORDER_STATUS_LABEL[order.status]}
          />
          <span className="text-sm font-semibold text-text">{formatMoney(order.totalAmount)}</span>
        </div>
      </Card>
    </Link>
  </li>
);

/** "My Orders" (S3-4). No cancel action here — cancellation is available only from order detail (`OrderConfirmationPage`). */
export const OrderHistoryPage = (): JSX.Element => {
  const { data: orders, isLoading, isError, error } = useListOrdersQuery();

  if (isLoading) {
    return (
      <main>
        <PageContainer>
          <div className="flex flex-col gap-6 py-6 sm:py-8">
            <h1 className="font-display text-xl font-bold tracking-tight text-text sm:text-2xl">
              My orders
            </h1>
            <OrderHistorySkeleton />
          </div>
        </PageContainer>
      </main>
    );
  }

  if (isError || !orders) {
    return (
      <main>
        <PageContainer>
          <div className="flex flex-col gap-6 py-6 sm:py-8">
            <h1 className="font-display text-xl font-bold tracking-tight text-text sm:text-2xl">
              My orders
            </h1>
            <Alert tone="danger" title="Your orders couldn’t be loaded">
              {apiErrorMessage(error, 'Your orders could not be loaded. Please try again.')}
            </Alert>
          </div>
        </PageContainer>
      </main>
    );
  }

  if (orders.length === 0) {
    return (
      <main>
        <PageContainer>
          <div className="py-12 sm:py-16">
            <EmptyState
              icon={<OrdersIcon />}
              title="No orders yet"
              description="Orders you place will show up here."
              action={
                <Link
                  to="/catalogue"
                  className="inline-flex h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-on-primary hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                >
                  Go to catalogue
                </Link>
              }
            />
          </div>
        </PageContainer>
      </main>
    );
  }

  return (
    <main>
      <PageContainer>
        <div className="flex flex-col gap-6 py-6 sm:py-8">
          <h1 className="font-display text-xl font-bold tracking-tight text-text sm:text-2xl">
            My orders
          </h1>
          <ul className="flex flex-col gap-3">
            {orders.map((order) => (
              <OrderSummaryRow key={order.id} order={order} />
            ))}
          </ul>
        </div>
      </PageContainer>
    </main>
  );
};
