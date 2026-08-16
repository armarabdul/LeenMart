import { Link } from 'react-router-dom';
import type { VendorSubOrderSummaryResponse } from '@leen-mart/contracts';
import { apiErrorMessage } from '@/shared/api/base-api';
import { formatMoney } from '@/shared/lib/format-money';
import { ORDER_STATUS_LABEL } from '@/shared/lib/order-status-label';
import { useListVendorOrdersQuery } from '@/features/vendor-order/vendor-order.api';

const VendorOrdersSkeleton = (): JSX.Element => (
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

const VendorOrderRow = ({
  order,
}: {
  readonly order: VendorSubOrderSummaryResponse;
}): JSX.Element => (
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

/** "Vendor Orders" (S3-5). Follows the same loading/error/empty/list shape `OrderHistoryPage` (customer-pwa) already established for the identical read pattern. */
export const VendorOrdersPage = (): JSX.Element => {
  const { data: orders, isLoading, isError, error } = useListVendorOrdersQuery();

  if (isLoading) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Orders</h1>
        <VendorOrdersSkeleton />
      </main>
    );
  }

  if (isError || !orders) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Orders</h1>
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
        <p className="text-sm text-slate-600">Orders customers place from you will show up here.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="text-xl font-bold tracking-tight text-slate-900">Orders</h1>
      <ul className="flex flex-col gap-3">
        {orders.map((order) => (
          <VendorOrderRow key={order.id} order={order} />
        ))}
      </ul>
    </main>
  );
};
