import { Alert, Card } from '@leen-mart/ui';
import { apiErrorMessage } from '@/shared/api/base-api';
import { useGetDemandSummaryQuery } from '../vendor-preorder-campaign.api';

/**
 * Real aggregates, read fresh from the backend on every mount — never
 * derived or faked client-side (the implementation brief's own explicit
 * instruction: "Do not fake aggregate data on the frontend").
 */
export const DemandSummaryCard = ({ campaignId }: { readonly campaignId: string }): JSX.Element => {
  const { data: summary, isLoading, isError, error } = useGetDemandSummaryQuery(campaignId);

  if (isLoading) {
    return (
      <div
        className="h-20 w-full animate-pulse rounded-md bg-slate-100"
        aria-busy="true"
        aria-label="Loading demand"
      />
    );
  }

  if (isError || !summary) {
    return (
      <Alert tone="danger">
        {apiErrorMessage(error, 'Demand for this campaign could not be loaded.')}
      </Alert>
    );
  }

  return (
    <Card className="flex flex-col gap-2 text-sm">
      <h2 className="text-sm font-semibold text-text">Demand</h2>
      <div className="flex justify-between">
        <span className="text-text-muted">Total reservations</span>
        <span className="text-text">{summary.reservationCount}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-text-muted">Confirmed</span>
        <span className="text-text">{summary.confirmedCount}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-text-muted">Units committed</span>
        <span className="text-text">{summary.totalUnitsCommitted}</span>
      </div>
    </Card>
  );
};
