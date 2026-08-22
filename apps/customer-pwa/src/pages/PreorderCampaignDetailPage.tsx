import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { PublicCampaignResponse, ReservationFulfilmentModeDto } from '@leen-mart/contracts';
import { Alert, Badge, Button, Card, Select, Skeleton, StatusBadge } from '@leen-mart/ui';
import { useAppSelector } from '@/app/hooks';
import { selectIsAuthenticated } from '@/shared/api/session.slice';
import { apiErrorMessage } from '@/shared/api/base-api';
import { PREORDER_CAMPAIGN_STATUS_LABEL } from '@/shared/lib/preorder-campaign-status-label';
import { PREORDER_CAMPAIGN_STATUS_TONE } from '@/shared/lib/preorder-campaign-status-tone';
import { PageContainer } from '@/components/PageContainer';
import { AddressSelector } from '@/features/address/components/AddressSelector';
import {
  useCreateReservationMutation,
  useGetPublicCampaignQuery,
} from '@/features/preorder/preorder.api';

const formatDateTime = (isoDateTime: string): string =>
  new Date(isoDateTime).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

const DetailSkeleton = (): JSX.Element => (
  <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading campaign">
    <Skeleton shape="rect" className="h-8 w-2/3" />
    <Skeleton shape="rect" className="h-40 w-full" />
  </div>
);

/**
 * The fulfilment-mode choice a customer makes at reservation time (Phase
 * Next) — captured here, once, because the resulting order needs an
 * unambiguous mode and nothing recovers one later (see
 * `CampaignFulfilmentMode`'s own backend doc comment). A `DELIVERY`- or
 * `PICKUP`-only campaign has nothing to choose, so no picker is shown at
 * all; only a `BOTH` campaign renders one.
 */
const FulfilmentModeField = ({
  allowed,
  value,
  onChange,
}: {
  readonly allowed: 'DELIVERY' | 'PICKUP' | 'BOTH';
  readonly value: ReservationFulfilmentModeDto;
  readonly onChange: (mode: ReservationFulfilmentModeDto) => void;
}): JSX.Element | null => {
  if (allowed !== 'BOTH') return null;
  return (
    <Select
      label="Fulfilment"
      value={value}
      onChange={(event) => onChange(event.target.value as ReservationFulfilmentModeDto)}
      options={[
        { value: 'DELIVERY', label: 'Delivery' },
        { value: 'PICKUP', label: 'Pickup' },
      ]}
    />
  );
};

const CampaignSummaryCard = ({
  campaign,
}: {
  readonly campaign: PublicCampaignResponse;
}): JSX.Element => (
  <Card className="flex flex-col gap-2 text-sm">
    <div className="flex justify-between">
      <span className="text-text-muted">Reservations close</span>
      <span className="text-text">{formatDateTime(campaign.orderCutoffAt)}</span>
    </div>
    <div className="flex justify-between">
      <span className="text-text-muted">Fulfilment window</span>
      <span className="text-text">
        {formatDateTime(campaign.fulfilmentWindowStart)} –{' '}
        {formatDateTime(campaign.fulfilmentWindowEnd)}
      </span>
    </div>
    <div className="flex justify-between">
      <span className="text-text-muted">Remaining</span>
      <span className="text-text">
        {campaign.remainingQuantity} of {campaign.totalQuantity}
      </span>
    </div>
    <div className="flex justify-between">
      <span className="text-text-muted">Limit per customer</span>
      <span className="text-text">{campaign.maxPerCustomer}</span>
    </div>
  </Card>
);

/**
 * The reserve panel's own form state and submit handler — split out of the
 * page purely to keep both functions within this repository's complexity
 * budget. Rendered only when `canReserve` is true; the caller decides that.
 */
const ReserveForm = ({ campaign }: { readonly campaign: PublicCampaignResponse }): JSX.Element => {
  const navigate = useNavigate();
  const isAuthenticated = useAppSelector(selectIsAuthenticated);
  const [quantity, setQuantity] = useState(1);
  const [fulfilmentMode, setFulfilmentMode] = useState<ReservationFulfilmentModeDto>('DELIVERY');
  const [addressId, setAddressId] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [createReservation, { isLoading: isReserving, error: reserveError }] =
    useCreateReservationMutation();

  if (!isAuthenticated) {
    return (
      <p className="text-sm text-text-muted">
        <Link to="/login" className="font-medium text-primary hover:text-primary-hover">
          Log in
        </Link>{' '}
        to reserve this preorder.
      </p>
    );
  }

  const maxQuantity = Math.min(campaign.maxPerCustomer, campaign.remainingQuantity);

  const handleReserve = async (): Promise<void> => {
    if (!addressId) return;
    try {
      const reservation = await createReservation({
        campaignId: campaign.id,
        quantity,
        fulfilmentMode,
        addressId,
        idempotencyKey,
      }).unwrap();
      void navigate(`/my-reservations/${reservation.id}`, { replace: true });
    } catch {
      // Surfaced below via `reserveError`.
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Select
        label="Quantity"
        value={String(quantity)}
        onChange={(event) => setQuantity(Number(event.target.value))}
        options={Array.from({ length: maxQuantity }, (_, index) => ({
          value: String(index + 1),
          label: String(index + 1),
        }))}
      />
      <FulfilmentModeField
        allowed={campaign.fulfilmentMode}
        value={fulfilmentMode}
        onChange={setFulfilmentMode}
      />
      <div>
        <p className="mb-1.5 text-sm font-medium text-text">Delivery address</p>
        <AddressSelector selectedAddressId={addressId} onSelect={setAddressId} />
      </div>

      {reserveError !== undefined && (
        <Alert tone="danger">
          {apiErrorMessage(reserveError, 'This reservation could not be created.')}
        </Alert>
      )}

      <Button
        type="button"
        size="lg"
        onClick={() => void handleReserve()}
        disabled={!addressId || isReserving}
        loading={isReserving}
        className="w-full"
      >
        Reserve now
      </Button>
      {!addressId && (
        <p className="text-center text-xs text-text-muted">
          Choose a delivery address to continue.
        </p>
      )}
    </div>
  );
};

const ReservePanel = ({ campaign }: { readonly campaign: PublicCampaignResponse }): JSX.Element => {
  const canReserve = campaign.status === 'OPEN' && campaign.remainingQuantity > 0;

  return (
    <Card className="flex flex-col gap-4 p-4 lg:sticky lg:top-24">
      <h2 className="text-sm font-semibold text-text">Reserve your spot</h2>
      {!canReserve && (
        <Badge tone="neutral">
          {campaign.status === 'OPEN'
            ? 'Sold out'
            : PREORDER_CAMPAIGN_STATUS_LABEL[campaign.status]}
        </Badge>
      )}
      {canReserve && <ReserveForm campaign={campaign} />}
    </Card>
  );
};

/** The campaign's own detail + reserve page (Phase Next). No product/variant name is ever known to the public campaign contract — a known, deliberate limitation rather than fabricated copy. */
export const PreorderCampaignDetailPage = (): JSX.Element => {
  const { campaignId } = useParams<{ campaignId: string }>();
  const {
    data: campaign,
    isLoading,
    isError,
    error,
  } = useGetPublicCampaignQuery(campaignId ?? '', { skip: !campaignId });

  if (!campaignId) {
    return (
      <main>
        <PageContainer>
          <div className="py-12 sm:py-16">
            <Alert tone="danger">This preorder campaign could not be found.</Alert>
          </div>
        </PageContainer>
      </main>
    );
  }

  if (isLoading) {
    return (
      <main>
        <PageContainer>
          <div className="py-6 sm:py-8">
            <DetailSkeleton />
          </div>
        </PageContainer>
      </main>
    );
  }

  if (isError || !campaign) {
    return (
      <main>
        <PageContainer>
          <div className="py-6 sm:py-8">
            <Alert tone="danger" title="This preorder couldn’t be loaded">
              {apiErrorMessage(error, 'This preorder campaign could not be loaded.')}
            </Alert>
          </div>
        </PageContainer>
      </main>
    );
  }

  return (
    <main>
      <PageContainer>
        <div className="flex flex-col gap-6 py-6 sm:py-8 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-8">
          <div className="flex flex-col gap-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="font-display text-xl font-bold tracking-tight text-text sm:text-2xl">
                  Preorder — Variant #{campaign.variantId.slice(0, 8)}
                </h1>
                <p className="mt-1 text-sm text-text-muted">
                  {campaign.advancePercent}% advance now, the rest before fulfilment.
                </p>
              </div>
              <StatusBadge
                tone={PREORDER_CAMPAIGN_STATUS_TONE[campaign.status]}
                label={PREORDER_CAMPAIGN_STATUS_LABEL[campaign.status]}
              />
            </div>
            <CampaignSummaryCard campaign={campaign} />
          </div>

          <ReservePanel campaign={campaign} />
        </div>
      </PageContainer>
    </main>
  );
};
