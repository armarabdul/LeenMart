import { Link } from 'react-router-dom';
import type { OrderSummaryResponse } from '@leen-mart/contracts';
import { apiErrorMessage } from '@/shared/api/base-api';
import { formatMoney } from '@/shared/lib/format-money';
import { ORDER_STATUS_LABEL } from '@/shared/lib/order-status-label';
import { useListOrdersQuery } from '@/features/checkout/checkout.api';

const OrderHistorySkeleton = (): JSX.Element => (
  <div className="flex flex-col gap-3">
    {Array.from({ length: 3 }, (_, index) => (
      <div key={index} className="h-20 w-full animate-pulse rounded-md bg-slate-100" />
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
    <Link
      to={`/orders/${order.id}`}
      className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white p-4 hover:border-slate-300"
    >
      <div className="flex flex-col gap-1">
        <span className="font-mono text-xs text-slate-500">{order.id}</span>
        <span className="text-sm text-slate-600">{formatOrderDate(order.createdAt)}</span>
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="text-sm font-medium text-slate-900">
          {ORDER_STATUS_LABEL[order.status]}
        </span>
        <span className="text-sm text-slate-700">{formatMoney(order.totalAmount)}</span>
      </div>
    </Link>
  </li>
);

/** "My Orders" (S3-4). No cancel action here — cancellation is available only from order detail (`OrderConfirmationPage`). */
export const OrderHistoryPage = (): JSX.Element => {
  const { data: orders, isLoading, isError, error } = useListOrdersQuery();

  if (isLoading) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">My orders</h1>
        <OrderHistorySkeleton />
      </main>
    );
  }

  if (isError || !orders) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">My orders</h1>
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {apiErrorMessage(error, 'Your orders could not be loaded. Please try again.')}
        </p>
      </main>
    );
  }

  if (orders.length === 0) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col items-center gap-4 px-4 py-16 text-center">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">No orders yet</h1>
        <p className="text-sm text-slate-600">Orders you place will show up here.</p>
        <Link
          to="/catalogue"
          className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
        >
          Go to catalogue
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="text-xl font-bold tracking-tight text-slate-900">My orders</h1>
      <ul className="flex flex-col gap-3">
        {orders.map((order) => (
          <OrderSummaryRow key={order.id} order={order} />
        ))}
      </ul>
    </main>
  );
};
