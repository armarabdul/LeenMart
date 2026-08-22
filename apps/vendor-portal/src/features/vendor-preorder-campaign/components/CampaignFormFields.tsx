import { Input, Select } from '@leen-mart/ui';
import type { PreorderCampaignFulfilmentModeDto } from '@leen-mart/contracts';
import type { CampaignFormState } from '../lib/campaign-form-state';

interface CampaignFormFieldsProps {
  readonly value: CampaignFormState;
  readonly onChange: (field: keyof CampaignFormState, value: string) => void;
  readonly errorFor: (field: keyof CampaignFormState) => string | undefined;
  /** `totalQuantity` may only increase once a reservation has confirmed (SDD §14.6) — the frozen fields stay editable in the DOM but the backend refuses a shrink; this only disables the window/cutoff fields entirely, since those may not change at all once frozen. */
  readonly frozen?: boolean;
}

/**
 * Every field `createCampaignRequestSchema`/`updateCampaignRequestSchema`
 * share — split out of both the create and edit pages purely to keep each
 * within this repository's complexity budget, the same reasoning
 * `VariantFields`/`ProductOptionalFields` already establish for the product
 * feature.
 */
export const CampaignFormFields = ({
  value,
  onChange,
  errorFor,
  frozen = false,
}: CampaignFormFieldsProps): JSX.Element => (
  <div className="flex flex-col gap-4">
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Input
        label="Opens at"
        type="datetime-local"
        required
        disabled={frozen}
        value={value.opensAt}
        onChange={(event) => onChange('opensAt', event.target.value)}
        error={errorFor('opensAt')}
      />
      <Input
        label="Reservations close at"
        type="datetime-local"
        required
        disabled={frozen}
        value={value.orderCutoffAt}
        onChange={(event) => onChange('orderCutoffAt', event.target.value)}
        error={errorFor('orderCutoffAt')}
      />
      <Input
        label="Fulfilment window starts"
        type="datetime-local"
        required
        disabled={frozen}
        value={value.fulfilmentWindowStart}
        onChange={(event) => onChange('fulfilmentWindowStart', event.target.value)}
        error={errorFor('fulfilmentWindowStart')}
      />
      <Input
        label="Fulfilment window ends"
        type="datetime-local"
        required
        disabled={frozen}
        value={value.fulfilmentWindowEnd}
        onChange={(event) => onChange('fulfilmentWindowEnd', event.target.value)}
        error={errorFor('fulfilmentWindowEnd')}
      />
    </div>

    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Input
        label="Total quantity"
        type="number"
        min={1}
        step={1}
        required
        value={value.totalQuantity}
        onChange={(event) => onChange('totalQuantity', event.target.value)}
        error={errorFor('totalQuantity')}
      />
      <Input
        label="Advance percent"
        type="number"
        min={0}
        max={100}
        step={1}
        required
        value={value.advancePercent}
        onChange={(event) => onChange('advancePercent', event.target.value)}
        error={errorFor('advancePercent')}
      />
      <Input
        label="Max per customer"
        type="number"
        min={1}
        step={1}
        required
        value={value.maxPerCustomer}
        onChange={(event) => onChange('maxPerCustomer', event.target.value)}
        error={errorFor('maxPerCustomer')}
      />
    </div>

    <Select
      label="Fulfilment mode"
      required
      value={value.fulfilmentMode}
      onChange={(event) =>
        onChange('fulfilmentMode', event.target.value as PreorderCampaignFulfilmentModeDto)
      }
      options={[
        { value: 'DELIVERY', label: 'Delivery only' },
        { value: 'PICKUP', label: 'Pickup only' },
        { value: 'BOTH', label: 'Delivery or pickup' },
      ]}
      error={errorFor('fulfilmentMode')}
    />
  </div>
);
