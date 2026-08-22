import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { createCampaignRequestSchema, type CreateCampaignRequest } from '@leen-mart/contracts';
import { Alert, Button } from '@leen-mart/ui';
import { apiErrorMessage, apiFieldErrors } from '@/shared/api/base-api';
import { validateWithSchema } from '@/shared/lib/validate-with-schema';
import { useListProductsQuery } from '@/features/vendor-product/vendor-product.api';
import { useListVariantsQuery } from '@/features/vendor-product/vendor-product-variant.api';
import { useCreateCampaignMutation } from '@/features/vendor-preorder-campaign/vendor-preorder-campaign.api';
import { VariantPicker } from '@/features/vendor-preorder-campaign/components/VariantPicker';
import { CampaignFormFields } from '@/features/vendor-preorder-campaign/components/CampaignFormFields';
import {
  EMPTY_CAMPAIGN_FORM,
  type CampaignFormState,
} from '@/features/vendor-preorder-campaign/lib/campaign-form-state';

/** `datetime-local`'s own value has no timezone offset — `isoDateTimeSchema` requires one, so this is the one conversion point every submit and every live-validation pass both go through. An empty string stays empty rather than becoming `Invalid Date`'s own ISO string, so the schema reports "required" instead of a confusing parse failure. */
const toIso = (localDateTime: string): string =>
  localDateTime === '' ? '' : new Date(localDateTime).toISOString();

const toRequestBody = (variantId: string, form: CampaignFormState): CreateCampaignRequest => ({
  variantId,
  opensAt: toIso(form.opensAt),
  orderCutoffAt: toIso(form.orderCutoffAt),
  fulfilmentWindowStart: toIso(form.fulfilmentWindowStart),
  fulfilmentWindowEnd: toIso(form.fulfilmentWindowEnd),
  totalQuantity: Number(form.totalQuantity),
  advancePercent: Number(form.advancePercent),
  maxPerCustomer: Number(form.maxPerCustomer),
  fulfilmentMode: form.fulfilmentMode,
});

/** `POST /vendor/preorder-campaigns` (Phase Next) — a campaign is created in `DRAFT`; the lifecycle sweep moves it forward from there (no "publish" action exists on this surface, see the backend's own `SweepCampaignLifecycleUseCase` doc comment). */
export const VendorPreorderCampaignCreatePage = (): JSX.Element => {
  const navigate = useNavigate();
  const [productId, setProductId] = useState('');
  const [variantId, setVariantId] = useState('');
  const [form, setForm] = useState<CampaignFormState>(EMPTY_CAMPAIGN_FORM);
  const [touched, setTouched] = useState(false);
  const [createCampaign, { isLoading: isSaving, error: saveError }] = useCreateCampaignMutation();
  const { data: products, isLoading: isProductsLoading } = useListProductsQuery();
  const { data: variants, isLoading: isVariantsLoading } = useListVariantsQuery(productId, {
    skip: !productId,
  });

  const requestBody = toRequestBody(variantId || '00000000-0000-0000-0000-000000000000', form);
  const localErrors = validateWithSchema(createCampaignRequestSchema, requestBody);
  const serverFieldErrors = apiFieldErrors(saveError);
  const fieldError = (field: keyof CampaignFormState): string | undefined =>
    (touched ? localErrors[field] : undefined) ?? serverFieldErrors[field];

  const handleFieldChange = (field: keyof CampaignFormState, value: string): void =>
    setForm((current) => ({ ...current, [field]: value }));

  const handleProductChange = (nextProductId: string): void => {
    setProductId(nextProductId);
    setVariantId('');
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (isSaving) return;
    setTouched(true);

    if (!variantId || Object.keys(localErrors).length > 0) return;

    try {
      const created = await createCampaign(toRequestBody(variantId, form)).unwrap();
      void navigate(`/preorder-campaigns/${created.id}`, { replace: true });
    } catch {
      // Surfaced below via `saveError`.
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="text-xl font-bold tracking-tight text-slate-900">New preorder campaign</h1>

      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="flex flex-col gap-4"
        noValidate
      >
        <VariantPicker
          productOptions={(products ?? []).map((product) => ({
            value: product.id,
            label: product.name,
          }))}
          isProductsLoading={isProductsLoading}
          variantOptions={(variants ?? []).map((variant) => ({
            value: variant.id,
            label: `${variant.name} (${variant.sku})`,
          }))}
          isVariantsLoading={isVariantsLoading}
          productId={productId}
          variantId={variantId}
          onProductChange={handleProductChange}
          onVariantChange={setVariantId}
          variantError={touched && !variantId ? 'Choose a variant.' : undefined}
        />

        <CampaignFormFields value={form} onChange={handleFieldChange} errorFor={fieldError} />

        {saveError !== undefined && Object.keys(serverFieldErrors).length === 0 && (
          <Alert tone="danger">
            {apiErrorMessage(saveError, 'Your preorder campaign could not be created.')}
          </Alert>
        )}

        <Button type="submit" size="lg" loading={isSaving} className="w-full sm:w-auto">
          {isSaving ? 'Creating…' : 'Create campaign'}
        </Button>
      </form>
    </main>
  );
};
