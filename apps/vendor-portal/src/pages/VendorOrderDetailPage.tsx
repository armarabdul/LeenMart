import { Link, useParams } from 'react-router-dom';
import type { OrderItemResponse, VendorSubOrderResponse } from '@leen-mart/contracts';
import { apiErrorMessage } from '@/shared/api/base-api';
import { formatMoney } from '@/shared/lib/format-money';
import { ORDER_STATUS_LABEL } from '@/shared/lib/order-status-label';
import { useGetVendorOrderQuery } from '@/features/vendor-order/vendor-order.api';
import { StartProcessingButton } from '@/features/vendor-order/components/StartProcessingButton';

const OrderSkeleton = (): JSX.Element => (
  <div className="flex flex-col gap-4">
    {Array.from({ length: 3 }, (_, index) => (
      <div key={index} className="h-20 w-full animate-pulse rounded-md bg-slate-100" />
    ))}
  </div>
);

/**
 * Every figure here comes straight from the sub-order's own stored snapshot
 * — mirrors `customer-pwa`'s `OrderConfirmationPage` reasoning exactly, one
 * level down (a single vendor's own items, never another vendor's).
 */
const OrderItemRow = ({ item }: { readonly item: OrderItemResponse }): JSX.Element => (
  <li className="flex items-center justify-between py-2 text-sm">
    <span className="text-slate-700">
      {item.productName} — {item.variantName}{' '}
      <span className="text-slate-400">× {item.quantity}</span>
    </span>
    <span className="text-right">
      <span className="block font-medium text-slate-900">{formatMoney(item.lineAmount)}</span>
      <span className="block text-xs text-slate-500">
        {item.tax.resolved ? `GST: ${formatMoney(item.tax.amount)}` : 'GST to be confirmed'}
      </span>
    </span>
  </li>
);

const AddressSummary = ({
  address,
}: {
  readonly address: VendorSubOrderResponse['address'];
}): JSX.Element => (
  <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700">
    <p className="font-medium text-slate-900">
      {address.recipientName} <span className="font-normal text-slate-500">({address.label})</span>
    </p>
    <p>
      {address.line1}
      {address.line2 ? `, ${address.line2}` : ''}, {address.city}, {address.state} {address.pincode}
    </p>
    <p>{address.phone}</p>
  </div>
);

/** "Vendor Order Detail" (S3-5). Start Processing is visible only while CONFIRMED — the accept/process-only path, no reject/cancel action anywhere on this page. */
export const VendorOrderDetailPage = (): JSX.Element => {
  const { id } = useParams<{ id: string }>();
  const {
    data: order,
    isLoading,
    isError,
    error,
  } = useGetVendorOrderQuery(id ?? '', {
    skip: !id,
  });

  if (isLoading) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Order</h1>
        <OrderSkeleton />
      </main>
    );
  }

  if (isError || !order) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Order</h1>
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {apiErrorMessage(error, 'This order could not be found.')}
        </p>
        <Link to="/orders" className="text-sm font-medium text-brand-700 hover:text-brand-600">
          Back to orders
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Order</h1>
          <p className="text-sm text-slate-600">
            Order <span className="font-mono">{order.id}</span>
          </p>
          <p className="text-sm font-medium text-slate-700">{ORDER_STATUS_LABEL[order.status]}</p>
        </div>
        {order.status === 'CONFIRMED' && <StartProcessingButton subOrderId={order.id} />}
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Delivery address
        </h2>
        <AddressSummary address={order.address} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Items</h2>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <ul className="divide-y divide-slate-100">
            {order.items.map((item) => (
              <OrderItemRow key={item.id} item={item} />
            ))}
          </ul>
          <div className="flex justify-end border-t border-slate-100 pt-2 text-sm font-medium text-slate-900">
            Total: {formatMoney(order.totalAmount)}
          </div>
        </div>
      </section>

      <Link to="/orders" className="text-sm font-medium text-brand-700 hover:text-brand-600">
        Back to orders
      </Link>
    </main>
  );
};
