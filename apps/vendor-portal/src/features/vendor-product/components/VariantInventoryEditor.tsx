import { useEffect, useState, type FormEvent } from 'react';
import { stockCountSchema } from '@leen-mart/contracts';
import { Alert, Button, Input } from '@leen-mart/ui';
import { apiErrorMessage, isApiError } from '@/shared/api/base-api';
import { useGetInventoryQuery, useSetInventoryMutation } from '../vendor-inventory.api';
import { InventorySaveFeedback } from './InventorySaveFeedback';

/** One variant's stock (S2-4, Phase J) — `GET/PATCH .../inventory`, version-guarded (D-B). */
export const VariantInventoryEditor = ({
  productId,
  variantId,
}: {
  readonly productId: string;
  readonly variantId: string;
}): JSX.Element => {
  const {
    data: inventory,
    isLoading,
    isError,
    error,
    refetch,
  } = useGetInventoryQuery({
    productId,
    variantId,
  });
  const [setInventory, { isLoading: isSaving, error: saveError }] = useSetInventoryMutation();
  const [available, setAvailable] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (inventory) setAvailable(String(inventory.available));
  }, [inventory]);

  const isVersionConflict =
    isApiError(saveError) && saveError.data.error.code === 'INVENTORY_VERSION_CONFLICT';
  const parsed = stockCountSchema.safeParse(Number(available));
  const localError =
    available.trim() !== '' && !parsed.success ? 'Enter a whole number, 0 or more' : undefined;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (isSaving || !inventory || !parsed.success) return;
    setSaved(false);
    try {
      await setInventory({
        productId,
        variantId,
        body: { available: parsed.data, version: inventory.version },
      }).unwrap();
      setSaved(true);
    } catch {
      // Surfaced below via `saveError`.
    }
  };

  if (isLoading) {
    return <p className="text-sm text-text-muted">Loading stock…</p>;
  }

  if (isError || !inventory) {
    return <Alert tone="danger">{apiErrorMessage(error, 'Stock could not be loaded.')}</Alert>;
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="flex flex-wrap items-end gap-3"
      noValidate
    >
      <Input
        label="Available stock"
        type="number"
        min={0}
        step={1}
        containerClassName="w-32"
        value={available}
        onChange={(event) => {
          setSaved(false);
          setAvailable(event.target.value);
        }}
        error={localError}
      />
      <p className="pb-2.5 text-xs text-text-muted">{inventory.reserved} reserved</p>
      <Button type="submit" variant="secondary" size="sm" loading={isSaving}>
        Update stock
      </Button>
      {isVersionConflict && (
        <Button type="button" variant="ghost" size="sm" onClick={() => void refetch()}>
          Refresh
        </Button>
      )}
      <InventorySaveFeedback
        saveError={saveError}
        isVersionConflict={isVersionConflict}
        saved={saved}
      />
    </form>
  );
};
