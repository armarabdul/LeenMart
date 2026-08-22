import { useState } from 'react';
import { useParams } from 'react-router-dom';
import type { UpdateCampaignRequest } from '@leen-mart/contracts';
import { Alert, StatusBadge } from '@leen-mart/ui';
import { apiErrorMessage } from '@/shared/api/base-api';
import {
  useGetCampaignQuery,
  useUpdateCampaignMutation,
} from '@/features/vendor-preorder-campaign/vendor-preorder-campaign.api';
import { CampaignDetailsForm } from '@/features/vendor-preorder-campaign/components/CampaignDetailsForm';
import { DemandSummaryCard } from '@/features/vendor-preorder-campaign/components/DemandSummaryCard';
import { CancelCampaignAction } from '@/features/vendor-preorder-campaign/components/CancelCampaignAction';
import { CAMPAIGN_STATUS_LABEL } from '@/features/vendor-preorder-campaign/lib/campaign-status-label';
import { CAMPAIGN_STATUS_TONE } from '@/features/vendor-preorder-campaign/lib/campaign-status-tone';

const EditSkeleton = (): JSX.Element => (
  <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading campaign">
    {Array.from({ length: 4 }, (_, index) => (
      <div key={index} className="h-16 w-full animate-pulse rounded-md bg-slate-100" />
    ))}
  </div>
);

/** `CANCELLED`/`COMPLETED`/`PARTIALLY_FULFILLED` are terminal — cancelling one that already reached one of these would just be refused server-side, so the action is not offered at all. */
const isCancellable = (status: string): boolean =>
  !['CANCELLED', 'COMPLETED', 'PARTIALLY_FULFILLED', 'FULFILLING'].includes(status);

/** One preorder campaign, in full (Phase Next) — details, demand, and cancellation. */
export const VendorPreorderCampaignDetailPage = (): JSX.Element => {
  const { id } = useParams<{ id: string }>();
  const {
    data: campaign,
    isLoading,
    isError,
    error,
  } = useGetCampaignQuery(id ?? '', { skip: !id });
  const [updateCampaign, { isLoading: isSaving, error: saveError }] = useUpdateCampaignMutation();
  const [justSaved, setJustSaved] = useState(false);

  const handleSave = async (body: UpdateCampaignRequest): Promise<void> => {
    if (!id) return;
    setJustSaved(false);
    try {
      await updateCampaign({ campaignId: id, body }).unwrap();
      setJustSaved(true);
    } catch {
      // Surfaced via `saveError` inside `CampaignDetailsForm`.
    }
  };

  if (isLoading) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Preorder campaign</h1>
        <EditSkeleton />
      </main>
    );
  }

  if (isError || !campaign || !id) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Preorder campaign</h1>
        <Alert tone="danger">{apiErrorMessage(error, 'This campaign could not be found.')}</Alert>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Preorder campaign</h1>
        <StatusBadge
          tone={CAMPAIGN_STATUS_TONE[campaign.status]}
          label={CAMPAIGN_STATUS_LABEL[campaign.status]}
        />
      </div>

      <CampaignDetailsForm
        campaign={campaign}
        onSave={handleSave}
        isSaving={isSaving}
        saveError={saveError}
        justSaved={justSaved}
      />

      <DemandSummaryCard campaignId={id} />

      <CancelCampaignAction campaignId={id} cancellable={isCancellable(campaign.status)} />
    </main>
  );
};
