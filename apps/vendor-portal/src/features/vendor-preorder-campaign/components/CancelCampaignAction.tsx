import { useState } from 'react';
import { Alert, Button, Textarea } from '@leen-mart/ui';
import { apiErrorMessage } from '@/shared/api/base-api';
import { useCancelCampaignMutation } from '../vendor-preorder-campaign.api';

/**
 * Cancels the campaign and releases every still-live reservation's held
 * quantity, server-side — no refund of any kind (BR-06/07 remain
 * unresolved; see `CancelCampaignUseCase`'s own doc comment). A vendor
 * confirms with a required reason, the same audit-trail discipline every
 * other vendor cancel action in this codebase already applies.
 */
export const CancelCampaignAction = ({
  campaignId,
  cancellable,
}: {
  readonly campaignId: string;
  readonly cancellable: boolean;
}): JSX.Element | null => {
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [cancelCampaign, { isLoading: isCancelling, error: cancelError }] =
    useCancelCampaignMutation();

  if (!cancellable) return null;

  const handleCancel = async (): Promise<void> => {
    if (reason.trim() === '') return;
    try {
      await cancelCampaign({ campaignId, body: { reason: reason.trim() } }).unwrap();
      setConfirming(false);
    } catch {
      // Surfaced below via `cancelError`.
    }
  };

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="secondary"
        className="self-start text-danger hover:bg-danger/10"
        onClick={() => setConfirming(true)}
      >
        Cancel campaign
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-card border border-danger/30 bg-danger/5 p-4">
      <p className="text-sm text-text">
        Cancelling releases every still-held reservation for this campaign. No refunds are issued by
        this action — refunds are handled outside the platform for now.
      </p>
      <Textarea
        label="Reason"
        required
        maxLength={500}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      {cancelError !== undefined && (
        <Alert tone="danger">
          {apiErrorMessage(cancelError, 'This campaign could not be cancelled.')}
        </Alert>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="danger"
          disabled={reason.trim() === '' || isCancelling}
          loading={isCancelling}
          onClick={() => void handleCancel()}
        >
          Confirm cancellation
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => setConfirming(false)}
          disabled={isCancelling}
        >
          Keep campaign
        </Button>
      </div>
    </div>
  );
};
