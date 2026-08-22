import { Link } from 'react-router-dom';
import type { VendorCampaignResponse } from '@leen-mart/contracts';
import { Alert, Button, Card, EmptyState, StatusBadge } from '@leen-mart/ui';
import { apiErrorMessage } from '@/shared/api/base-api';
import { useListCampaignsQuery } from '@/features/vendor-preorder-campaign/vendor-preorder-campaign.api';
import { CAMPAIGN_STATUS_LABEL } from '@/features/vendor-preorder-campaign/lib/campaign-status-label';
import { CAMPAIGN_STATUS_TONE } from '@/features/vendor-preorder-campaign/lib/campaign-status-tone';

/** Named predicates, not inline `&&`/`||` chains — mirrors `VendorProductsPage`'s own reasoning, kept within this repository's complexity budget. */
const hasLoadError = (isLoading: boolean, isError: boolean, campaigns: unknown): boolean =>
  !isLoading && (isError || !campaigns);
const isEmpty = (
  isLoading: boolean,
  campaigns: readonly VendorCampaignResponse[] | undefined,
): boolean => !isLoading && !!campaigns && campaigns.length === 0;
const hasCampaigns = (
  isLoading: boolean,
  campaigns: readonly VendorCampaignResponse[] | undefined,
): boolean => !isLoading && !!campaigns && campaigns.length > 0;

const CampaignsSkeleton = (): JSX.Element => (
  <div
    className="flex flex-col gap-3"
    aria-busy="true"
    aria-label="Loading your preorder campaigns"
  >
    {Array.from({ length: 3 }, (_, index) => (
      <div key={index} className="h-20 w-full animate-pulse rounded-md bg-slate-100" />
    ))}
  </div>
);

const CampaignRow = ({ campaign }: { readonly campaign: VendorCampaignResponse }): JSX.Element => (
  <li>
    <Link to={`/preorder-campaigns/${campaign.id}`} className="block">
      <Card interactive className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate font-mono text-xs text-text-muted">
            Variant #{campaign.variantId.slice(0, 8)}
          </p>
          <p className="text-sm text-text-muted">
            {campaign.remainingQuantity} of {campaign.totalQuantity} remaining
          </p>
        </div>
        <StatusBadge
          tone={CAMPAIGN_STATUS_TONE[campaign.status]}
          label={CAMPAIGN_STATUS_LABEL[campaign.status]}
        />
      </Card>
    </Link>
  </li>
);

/** The vendor's own preorder campaigns (Phase Next) — `GET /vendor/preorder-campaigns`, tenant-scoped to the caller. */
export const VendorPreorderCampaignsPage = (): JSX.Element => {
  const { data: campaigns, isLoading, isError, error, refetch } = useListCampaignsQuery();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Preorder campaigns</h1>
        <Link
          to="/preorder-campaigns/new"
          className="inline-flex h-10 items-center rounded-md bg-brand-700 px-4 text-sm font-medium text-white hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          New campaign
        </Link>
      </div>

      {isLoading && <CampaignsSkeleton />}

      {hasLoadError(isLoading, isError, campaigns) && (
        <div className="flex flex-col gap-3">
          <Alert tone="danger">
            {apiErrorMessage(error, 'Your preorder campaigns could not be loaded.')}
          </Alert>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void refetch()}
            className="self-start"
          >
            Try again
          </Button>
        </div>
      )}

      {isEmpty(isLoading, campaigns) && (
        <EmptyState
          title="No preorder campaigns yet"
          description="Create a campaign to start taking reservations ahead of stock."
          action={
            <Link
              to="/preorder-campaigns/new"
              className="inline-flex h-10 items-center rounded-md bg-brand-700 px-4 text-sm font-medium text-white hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              New campaign
            </Link>
          }
        />
      )}

      {hasCampaigns(isLoading, campaigns) && campaigns && (
        <ul className="flex flex-col gap-3">
          {campaigns.map((campaign) => (
            <CampaignRow key={campaign.id} campaign={campaign} />
          ))}
        </ul>
      )}
    </main>
  );
};
