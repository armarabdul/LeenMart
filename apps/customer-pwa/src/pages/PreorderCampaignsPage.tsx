import { Link } from 'react-router-dom';
import type { PublicCampaignResponse } from '@leen-mart/contracts';
import { Alert, Card, EmptyState, Skeleton, StatusBadge } from '@leen-mart/ui';
import { apiErrorMessage } from '@/shared/api/base-api';
import { PREORDER_CAMPAIGN_STATUS_LABEL } from '@/shared/lib/preorder-campaign-status-label';
import { PREORDER_CAMPAIGN_STATUS_TONE } from '@/shared/lib/preorder-campaign-status-tone';
import { PageContainer } from '@/components/PageContainer';
import { useListPublicCampaignsQuery } from '@/features/preorder/preorder.api';

const PreorderIcon = (): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-8 w-8 text-text-faint">
    <path
      d="M12 3 4 7v10l8 4 8-4V7l-8-4Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path
      d="M4 7l8 4 8-4M12 11v10"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  </svg>
);

const PreorderCampaignsSkeleton = (): JSX.Element => (
  <div
    className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
    aria-busy="true"
    aria-label="Loading preorder campaigns"
  >
    {Array.from({ length: 6 }, (_, index) => (
      <Skeleton key={index} shape="rect" className="h-32 w-full" />
    ))}
  </div>
);

const formatWindowDate = (isoDateTime: string): string =>
  new Date(isoDateTime).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

const CampaignCard = ({ campaign }: { readonly campaign: PublicCampaignResponse }): JSX.Element => (
  <li>
    <Link to={`/preorders/${campaign.id}`} className="block h-full">
      <Card interactive className="flex h-full flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <span className="font-mono text-xs text-text-faint">
            Variant #{campaign.variantId.slice(0, 8)}
          </span>
          <StatusBadge
            tone={PREORDER_CAMPAIGN_STATUS_TONE[campaign.status]}
            label={PREORDER_CAMPAIGN_STATUS_LABEL[campaign.status]}
          />
        </div>
        <p className="text-sm text-text-muted">
          Fulfils {formatWindowDate(campaign.fulfilmentWindowStart)} –{' '}
          {formatWindowDate(campaign.fulfilmentWindowEnd)}
        </p>
        <p className="mt-auto text-sm font-medium text-text">
          {campaign.remainingQuantity} of {campaign.totalQuantity} left · {campaign.advancePercent}%
          advance
        </p>
      </Card>
    </Link>
  </li>
);

const PageHeading = (): JSX.Element => (
  <div>
    <h1 className="font-display text-xl font-bold tracking-tight text-text sm:text-2xl">
      Preorders
    </h1>
    <p className="mt-1 text-sm text-text-muted">
      Reserve upcoming stock ahead of time with a partial advance payment.
    </p>
  </div>
);

/** Public preorder campaign browse (Phase Next) — unauthenticated, mirrors `OrderHistoryPage`'s own loading/error/empty conventions. */
export const PreorderCampaignsPage = (): JSX.Element => {
  const { data: campaigns, isLoading, isError, error } = useListPublicCampaignsQuery();

  if (isLoading) {
    return (
      <main>
        <PageContainer>
          <div className="flex flex-col gap-6 py-6 sm:py-8">
            <PageHeading />
            <PreorderCampaignsSkeleton />
          </div>
        </PageContainer>
      </main>
    );
  }

  if (isError || !campaigns) {
    return (
      <main>
        <PageContainer>
          <div className="flex flex-col gap-6 py-6 sm:py-8">
            <PageHeading />
            <Alert tone="danger" title="Preorders couldn’t be loaded">
              {apiErrorMessage(error, 'Preorder campaigns could not be loaded. Please try again.')}
            </Alert>
          </div>
        </PageContainer>
      </main>
    );
  }

  if (campaigns.length === 0) {
    return (
      <main>
        <PageContainer>
          <div className="flex flex-col gap-6 py-6 sm:py-8">
            <PageHeading />
            <div className="py-12 sm:py-16">
              <EmptyState
                icon={<PreorderIcon />}
                title="No preorders open right now"
                description="Check back soon — new preorder campaigns will show up here."
              />
            </div>
          </div>
        </PageContainer>
      </main>
    );
  }

  return (
    <main>
      <PageContainer>
        <div className="flex flex-col gap-6 py-6 sm:py-8">
          <PageHeading />
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {campaigns.map((campaign) => (
              <CampaignCard key={campaign.id} campaign={campaign} />
            ))}
          </ul>
        </div>
      </PageContainer>
    </main>
  );
};
