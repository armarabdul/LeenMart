import { Link, useParams } from 'react-router-dom';
import type {
  OrderItemResponse,
  OrderResponse,
  OrderStatusDto,
  SubOrderResponse,
} from '@leen-mart/contracts';
import { apiErrorMessage } from '@/shared/api/base-api';
import { formatMoney } from '@/shared/lib/format-money';
import { useGetOrderQuery } from '@/features/checkout/checkout.api';
import { TestPaymentPanel } from '@/features/payment/components/TestPaymentPanel';

const OrderSkeleton = (): JSX.Element => (
  <div className="flex flex-col gap-4">
    {Array.from({ length: 3 }, (_, index) => (
      <div key={index} className="h-20 w-full animate-pulse rounded-md bg-slate-100" />
    ))}
  </div>
);

const STATUS_LABEL: Record<OrderStatusDto, string> = {
  PENDING_PAYMENT: 'Payment pending',
  CONFIRMED: 'Confirmed',
  PROCESSING: 'Processing',
  CANCELLED: 'Cancelled',
};

/**
 * Every figure here comes straight from the order's own stored snapshot
 * (`OrderResponse`/`OrderItemResponse`) — never `knownVariants`. A vendor
 * editing a price or a product later must never change what this page shows
 * for an order already placed (SDD 6.3).
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

const SubOrderCard = ({ subOrder }: { readonly subOrder: SubOrderResponse }): JSX.Element => (
  <div className="rounded-lg border border-slate-200 bg-white p-4">
    <div className="flex items-center justify-between">
      <h3 className="text-sm font-semibold text-slate-900">Sold by {subOrder.vendorShopName}</h3>
      <span className="text-xs font-medium text-slate-500">{STATUS_LABEL[subOrder.status]}</span>
    </div>
    <ul className="divide-y divide-slate-100">
      {subOrder.items.map((item) => (
        <OrderItemRow key={item.id} item={item} />
      ))}
    </ul>
    <div className="flex justify-end border-t border-slate-100 pt-2 text-sm font-medium text-slate-900">
      Subtotal: {formatMoney(subOrder.totalAmount)}
    </div>
  </div>
);

const AddressSummary = ({
  address,
}: {
  readonly address: OrderResponse['address'];
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

export const OrderConfirmationPage = (): JSX.Element => {
  const { id } = useParams<{ id: string }>();
  const { data: order, isLoading, isError, error } = useGetOrderQuery(id ?? '', { skip: !id });

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
        <Link to="/catalogue" className="text-sm font-medium text-brand-700 hover:text-brand-600">
          Continue shopping
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Order placed</h1>
        <p className="text-sm text-slate-600">
          Order <span className="font-mono">{order.id}</span>
        </p>
      </header>

      {order.status === 'PENDING_PAYMENT' && <TestPaymentPanel orderId={order.id} />}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Delivery address
        </h2>
        <AddressSummary address={order.address} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Items ({STATUS_LABEL[order.status]})
        </h2>
        <div className="flex flex-col gap-3">
          {order.subOrders.map((subOrder) => (
            <SubOrderCard key={subOrder.id} subOrder={subOrder} />
          ))}
        </div>
      </section>

      <div className="flex justify-end text-lg font-semibold text-slate-900">
        Total: {formatMoney(order.totalAmount)}
      </div>

      <Link to="/catalogue" className="text-sm font-medium text-brand-700 hover:text-brand-600">
        Continue shopping
      </Link>
    </main>
  );
};
