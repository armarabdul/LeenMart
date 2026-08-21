import { Link, useParams } from 'react-router-dom';
import type { OrderItemResponse, OrderResponse, SubOrderResponse } from '@leen-mart/contracts';
import { Alert, Card, Skeleton, StatusBadge } from '@leen-mart/ui';
import { apiErrorMessage } from '@/shared/api/base-api';
import { formatMoney } from '@/shared/lib/format-money';
import { ORDER_STATUS_LABEL } from '@/shared/lib/order-status-label';
import { ORDER_STATUS_TONE } from '@/shared/lib/order-status-tone';
import { PageContainer } from '@/components/PageContainer';
import { PickupLocationPanel } from '@/features/checkout/components/PickupLocationPanel';
import { PickupQrPanel } from '@/features/checkout/components/PickupQrPanel';
import { useGetOrderQuery } from '@/features/checkout/checkout.api';
import { TestPaymentPanel } from '@/features/payment/components/TestPaymentPanel';
import { CancelOrderButton } from '@/features/checkout/components/CancelOrderButton';
import { WriteReviewControl } from '@/features/review/components/WriteReviewControl';

const OrderSkeleton = (): JSX.Element => (
  <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading your order">
    {Array.from({ length: 3 }, (_, index) => (
      <Skeleton key={index} shape="rect" className="h-20 w-full" />
    ))}
  </div>
);

/**
 * Every figure here comes straight from the order's own stored snapshot
 * (`OrderResponse`/`OrderItemResponse`) — never `knownVariants`. A vendor
 * editing a price or a product later must never change what this page shows
 * for an order already placed (SDD 6.3).
 */
const OrderItemRow = ({
  item,
  subOrderStatus,
}: {
  readonly item: OrderItemResponse;
  readonly subOrderStatus: string;
}): JSX.Element => (
  <li className="flex items-start justify-between gap-3 py-2 text-sm">
    <span className="min-w-0 text-text-muted">
      {item.productName} — {item.variantName}{' '}
      <span className="text-text-faint">× {item.quantity}</span>
      {/* S8-REVIEWS: only once this item's sub-order has reached DELIVERED/COMPLETED. */}
      <WriteReviewControl orderItemId={item.id} subOrderStatus={subOrderStatus} />
    </span>
    <span className="shrink-0 text-right">
      <span className="block font-medium text-text">{formatMoney(item.lineAmount)}</span>
      <span className="block text-xs text-text-muted">
        {item.tax.resolved ? `GST: ${formatMoney(item.tax.amount)}` : 'GST to be confirmed'}
      </span>
    </span>
  </li>
);

const SubOrderCard = ({
  subOrder,
  orderId,
}: {
  readonly subOrder: SubOrderResponse;
  readonly orderId: string;
}): JSX.Element => (
  <Card className="flex flex-col gap-1">
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-sm font-semibold text-text">Sold by {subOrder.vendorShopName}</h3>
      <StatusBadge
        tone={ORDER_STATUS_TONE[subOrder.status]}
        label={ORDER_STATUS_LABEL[subOrder.status]}
      />
    </div>
    <ul className="divide-y divide-border">
      {subOrder.items.map((item) => (
        <OrderItemRow key={item.id} item={item} subOrderStatus={subOrder.status} />
      ))}
    </ul>
    {/* S4-ADDR: where to collect, from the order's own snapshot. Shown for
        the whole life of a pickup sub-order — the customer needs the address
        from the moment they order, not only once it is ready. `null` for
        every DELIVERY sub-order, and for pickup orders placed before the
        vendor had an address. */}
    {subOrder.fulfilmentMode === 'PICKUP' && subOrder.pickupLocation && (
      <PickupLocationPanel shopName={subOrder.vendorShopName} location={subOrder.pickupLocation} />
    )}
    {/* S4-QR: the QR appears only once this vendor has actually marked the
        pickup ready — the customer has nothing to show before that, and the
        backend refuses to issue a token in any other state. */}
    {subOrder.fulfilmentMode === 'PICKUP' && subOrder.status === 'READY_FOR_PICKUP' && (
      <PickupQrPanel orderId={orderId} subOrderId={subOrder.id} />
    )}
    <div className="flex justify-end border-t border-border pt-2 text-sm font-medium text-text">
      Subtotal: {formatMoney(subOrder.totalAmount)}
    </div>
  </Card>
);

const AddressSummary = ({
  address,
}: {
  readonly address: OrderResponse['address'];
}): JSX.Element => (
  <Card className="text-sm text-text-muted">
    <p className="font-medium text-text">
      {address.recipientName} <span className="font-normal text-text-muted">({address.label})</span>
    </p>
    <p>
      {address.line1}
      {address.line2 ? `, ${address.line2}` : ''}, {address.city}, {address.state} {address.pincode}
    </p>
    <p>{address.phone}</p>
  </Card>
);

const OrderShell = ({ children }: { readonly children: React.ReactNode }): JSX.Element => (
  <main>
    <PageContainer>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-6 sm:py-8">
        <h1 className="font-display text-xl font-bold tracking-tight text-text sm:text-2xl">
          Order
        </h1>
        {children}
      </div>
    </PageContainer>
  </main>
);

export const OrderConfirmationPage = (): JSX.Element => {
  const { id } = useParams<{ id: string }>();
  const { data: order, isLoading, isError, error } = useGetOrderQuery(id ?? '', { skip: !id });

  if (isLoading) {
    return (
      <OrderShell>
        <OrderSkeleton />
      </OrderShell>
    );
  }

  if (isError || !order) {
    return (
      <OrderShell>
        <Alert tone="danger" title="Order not found">
          {apiErrorMessage(error, 'This order could not be found.')}
        </Alert>
        <Link to="/catalogue" className="text-sm font-medium text-primary hover:text-primary-hover">
          Continue shopping
        </Link>
      </OrderShell>
    );
  }

  return (
    <main>
      <PageContainer>
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-6 sm:py-8">
          <header className="flex flex-col gap-1">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="font-display text-xl font-bold tracking-tight text-text sm:text-2xl">
                  Order placed
                </h1>
                <p className="text-sm text-text-muted">
                  Order <span className="font-mono">{order.id}</span>
                </p>
              </div>
              {(order.status === 'PENDING_PAYMENT' || order.status === 'CONFIRMED') && (
                <CancelOrderButton orderId={order.id} />
              )}
            </div>
          </header>

          {order.status === 'PENDING_PAYMENT' && <TestPaymentPanel orderId={order.id} />}

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-text-faint">
              Delivery address
            </h2>
            <AddressSummary address={order.address} />
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-text-faint">Items</h2>
            <div className="flex flex-col gap-3">
              {order.subOrders.map((subOrder) => (
                <SubOrderCard key={subOrder.id} subOrder={subOrder} orderId={order.id} />
              ))}
            </div>
          </section>

          <div className="flex justify-end border-t border-border pt-4 text-lg font-semibold text-text">
            Total: {formatMoney(order.totalAmount)}
          </div>

          <Link
            to="/catalogue"
            className="text-sm font-medium text-primary hover:text-primary-hover"
          >
            Continue shopping
          </Link>
        </div>
      </PageContainer>
    </main>
  );
};
