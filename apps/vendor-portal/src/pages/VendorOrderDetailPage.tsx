import { Link, useParams } from 'react-router-dom';
import type { OrderItemResponse, VendorSubOrderResponse } from '@leen-mart/contracts';
import { apiErrorMessage } from '@/shared/api/base-api';
import { formatMoney } from '@/shared/lib/format-money';
import { ORDER_STATUS_LABEL } from '@/shared/lib/order-status-label';
import { useGetVendorOrderQuery } from '@/features/vendor-order/vendor-order.api';
import { StartProcessingButton } from '@/features/vendor-order/components/StartProcessingButton';
import { MarkShippedButton } from '@/features/vendor-order/components/MarkShippedButton';
import { MarkDeliveredButton } from '@/features/vendor-order/components/MarkDeliveredButton';
import { MarkReadyForPickupButton } from '@/features/vendor-order/components/MarkReadyForPickupButton';

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

/**
 * The single status-gated fulfilment action shown in the page header.
 *
 * Extracted from `VendorOrderDetailPage` so the page itself stays within the
 * complexity budget; the branches are byte-for-byte the ones it used to hold
 * inline, in the same order. The sub-order's statuses are mutually exclusive,
 * so at most one of these ever matched before and at most one returns here —
 * `null` covers the states with no action at all (DELIVERED, COMPLETED,
 * CANCELLED).
 */
const FulfilmentAction = ({
  subOrder,
}: {
  readonly subOrder: VendorSubOrderResponse;
}): JSX.Element | null => {
  const { id, status, fulfilmentMode } = subOrder;

  if (status === 'CONFIRMED') {
    return <StartProcessingButton subOrderId={id} />;
  }
  if (status === 'PROCESSING' && fulfilmentMode === 'DELIVERY') {
    return <MarkShippedButton subOrderId={id} />;
  }
  // S4-QR: the pickup-mode branch. A PICKUP sub-order never offers
  // ship/deliver, and COMPLETED is reached only by the vendor redeeming the
  // customer's QR code on /pickup/redeem — never by a button here (locked
  // decision #10).
  if (status === 'PROCESSING' && fulfilmentMode === 'PICKUP') {
    return <MarkReadyForPickupButton subOrderId={id} />;
  }
  if (status === 'SHIPPED') {
    return <MarkDeliveredButton subOrderId={id} />;
  }
  if (status === 'READY_FOR_PICKUP') {
    return (
      <p className="text-sm text-slate-600">
        Awaiting customer pickup — redeem their QR code to complete.
      </p>
    );
  }
  return null;
};

/**
 * "Vendor Order Detail" (S3-5, extended S3-6). Exactly one fulfilment
 * action is ever visible, gated strictly on the sub-order's current status:
 * Start Processing (CONFIRMED), Mark Shipped (PROCESSING), Mark Delivered
 * (SHIPPED). DELIVERED shows no action at all — it is this milestone's
 * terminal state (locked decision #4). No reject/cancel action exists
 * anywhere on this page.
 */
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
        <FulfilmentAction subOrder={order} />
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
