import type { AdminKycSubmissionDetail, DecideVendorKycRequest } from '@leen-mart/contracts';
import { Alert, Button } from '@leen-mart/ui';
import { apiErrorMessage } from '@/shared/api/base-api';
import {
  useActivateVendorMutation,
  useDecideKycMutation,
  useStartKycReviewMutation,
} from '../kyc-review.api';
import { KycDecisionForm } from './KycDecisionForm';

interface KycActionPanelProps {
  readonly kycId: string;
  readonly data: AdminKycSubmissionDetail;
}

/**
 * Claim → decide → (approve →) activate, kept as the three separate
 * backend operations they actually are (locked scope: never combine
 * approval and activation). Split out of `KycDetailPage` to keep that
 * component's branching within this repository's complexity budget.
 */
export const KycActionPanel = ({ kycId, data }: KycActionPanelProps): JSX.Element | null => {
  const [startReview, { isLoading: isClaiming, error: claimError }] = useStartKycReviewMutation();
  const [decideKyc, { isLoading: isDeciding, error: decideError }] = useDecideKycMutation();
  const [activateVendor, { isLoading: isActivating, error: activateError }] =
    useActivateVendorMutation();

  const handleDecide = (body: DecideVendorKycRequest): void => {
    void decideKyc({ kycId, body });
  };

  if (data.vendorStatus === 'KYC_SUBMITTED') {
    return (
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          loading={isClaiming}
          onClick={() => void startReview(kycId)}
          className="self-start"
        >
          Claim for review
        </Button>
        {claimError !== undefined && (
          <Alert tone="danger">
            {apiErrorMessage(claimError, 'This submission could not be claimed.')}
          </Alert>
        )}
      </div>
    );
  }

  if (data.vendorStatus === 'KYC_UNDER_REVIEW') {
    return (
      <KycDecisionForm
        isSubmitting={isDeciding}
        submitError={decideError}
        onDecide={handleDecide}
      />
    );
  }

  if (data.vendorStatus === 'KYC_APPROVED') {
    return (
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          loading={isActivating}
          onClick={() => void activateVendor(data.vendorId)}
          className="self-start"
        >
          Activate vendor
        </Button>
        {activateError !== undefined && (
          <Alert tone="danger">
            {apiErrorMessage(activateError, 'This vendor could not be activated.')}
          </Alert>
        )}
      </div>
    );
  }

  return null;
};
