import { useState, type FormEvent } from 'react';
import type { UpdateCampaignRequest, VendorCampaignResponse } from '@leen-mart/contracts';
import { updateCampaignRequestSchema } from '@leen-mart/contracts';
import { Alert, Button } from '@leen-mart/ui';
import { apiErrorMessage, apiFieldErrors } from '@/shared/api/base-api';
import { validateWithSchema } from '@/shared/lib/validate-with-schema';
import { CampaignFormFields } from './CampaignFormFields';
import type { CampaignFormState } from '../lib/campaign-form-state';

/** `YYYY-MM-DDTHH:mm` — `datetime-local`'s own value format, sliced off the full ISO string (no timezone conversion needed for round-tripping back into the same input). */
const toLocalInput = (isoDateTime: string): string => isoDateTime.slice(0, 16);

const toForm = (campaign: VendorCampaignResponse): CampaignFormState => ({
  opensAt: toLocalInput(campaign.opensAt),
  orderCutoffAt: toLocalInput(campaign.orderCutoffAt),
  fulfilmentWindowStart: toLocalInput(campaign.fulfilmentWindowStart),
  fulfilmentWindowEnd: toLocalInput(campaign.fulfilmentWindowEnd),
  totalQuantity: String(campaign.totalQuantity),
  advancePercent: String(campaign.advancePercent),
  maxPerCustomer: String(campaign.maxPerCustomer),
  fulfilmentMode: campaign.fulfilmentMode,
});

const toIso = (localDateTime: string): string => new Date(localDateTime).toISOString();

const toRequestBody = (form: CampaignFormState): UpdateCampaignRequest => ({
  opensAt: toIso(form.opensAt),
  orderCutoffAt: toIso(form.orderCutoffAt),
  fulfilmentWindowStart: toIso(form.fulfilmentWindowStart),
  fulfilmentWindowEnd: toIso(form.fulfilmentWindowEnd),
  totalQuantity: Number(form.totalQuantity),
  advancePercent: Number(form.advancePercent),
  maxPerCustomer: Number(form.maxPerCustomer),
  fulfilmentMode: form.fulfilmentMode,
});

interface CampaignDetailsFormProps {
  readonly campaign: VendorCampaignResponse;
  readonly onSave: (body: UpdateCampaignRequest) => Promise<void>;
  readonly isSaving: boolean;
  readonly saveError: unknown;
  readonly justSaved: boolean;
}

/**
 * The editable campaign fields (Phase Next) — everything
 * `updateCampaignRequestSchema` allows. `frozen` (SDD §14.6: quantity may
 * only increase and the cutoff/window are immovable once a reservation has
 * confirmed) is derived from `firstReservationConfirmedAt` and only disables
 * the four schedule fields — `totalQuantity` stays editable, since it may
 * still increase; the backend's own domain entity refuses a decrease if the
 * vendor tries.
 */
export const CampaignDetailsForm = ({
  campaign,
  onSave,
  isSaving,
  saveError,
  justSaved,
}: CampaignDetailsFormProps): JSX.Element => {
  const [form, setForm] = useState<CampaignFormState>(() => toForm(campaign));
  const [touched, setTouched] = useState(false);
  const frozen = campaign.firstReservationConfirmedAt !== null;

  const localErrors = validateWithSchema(updateCampaignRequestSchema, toRequestBody(form));
  const serverFieldErrors = apiFieldErrors(saveError);
  const fieldError = (field: keyof CampaignFormState): string | undefined =>
    (touched ? localErrors[field] : undefined) ?? serverFieldErrors[field];

  const handleFieldChange = (field: keyof CampaignFormState, value: string): void =>
    setForm((current) => ({ ...current, [field]: value }));

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (isSaving) return;
    setTouched(true);
    if (Object.keys(localErrors).length > 0) return;
    await onSave(toRequestBody(form));
  };

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4" noValidate>
      {frozen && (
        <Alert tone="info">
          A reservation has already confirmed against this campaign — the cutoff and fulfilment
          window are now frozen, and quantity may only increase.
        </Alert>
      )}

      <CampaignFormFields
        value={form}
        onChange={handleFieldChange}
        errorFor={fieldError}
        frozen={frozen}
      />

      {saveError !== undefined && Object.keys(serverFieldErrors).length === 0 && (
        <Alert tone="danger">
          {apiErrorMessage(saveError, 'Your changes could not be saved.')}
        </Alert>
      )}
      {justSaved && <Alert tone="success">Campaign saved.</Alert>}

      <Button type="submit" loading={isSaving} className="self-start">
        {isSaving ? 'Saving…' : 'Save changes'}
      </Button>
    </form>
  );
};
