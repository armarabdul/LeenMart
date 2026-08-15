import { describe, expect, it } from 'vitest';
import type { MoneyDto } from '@leen-mart/contracts';
import {
  knownVariantsReducer,
  selectKnownVariant,
  selectKnownVariants,
  variantsObserved,
  type KnownVariantSummary,
} from '@/shared/state/known-variants.slice';

const price: MoneyDto = { amount: '19900', currency: 'INR' };

const summary = (overrides: Partial<KnownVariantSummary> = {}): KnownVariantSummary => ({
  variantId: 'variant-1',
  productId: 'product-1',
  productName: 'Alphonso Mango',
  variantName: '1 kg pack',
  price,
  unitOfMeasure: 'kg',
  quantityStep: 1,
  available: 10,
  ...overrides,
});

describe('knownVariants reducer', () => {
  it('starts empty', () => {
    const state = knownVariantsReducer(undefined, { type: '@@INIT' });
    expect(state.byVariantId).toEqual({});
  });

  it('records an observed variant, keyed by variantId', () => {
    const state = knownVariantsReducer(undefined, variantsObserved([summary()]));
    expect(state.byVariantId['variant-1']).toEqual(summary());
  });

  it('records every variant from a multi-variant product in one dispatch', () => {
    const small = summary({ variantId: 'variant-small', variantName: '500 g pack' });
    const large = summary({ variantId: 'variant-large', variantName: '1 kg pack' });

    const state = knownVariantsReducer(undefined, variantsObserved([small, large]));

    expect(state.byVariantId['variant-small']).toEqual(small);
    expect(state.byVariantId['variant-large']).toEqual(large);
  });

  it('overwrites a stale entry when the same variant is observed again', () => {
    const stale = summary({ available: 10 });
    const fresh = summary({ available: 3 });

    let state = knownVariantsReducer(undefined, variantsObserved([stale]));
    state = knownVariantsReducer(state, variantsObserved([fresh]));

    expect(state.byVariantId['variant-1']?.available).toBe(3);
  });

  it('never fabricates an entry for a variant that was never observed', () => {
    const state = knownVariantsReducer(undefined, variantsObserved([summary()]));
    expect(state.byVariantId['some-other-variant']).toBeUndefined();
  });
});

describe('selectKnownVariant / selectKnownVariants', () => {
  it('resolves an observed variant by id', () => {
    const state = { knownVariants: knownVariantsReducer(undefined, variantsObserved([summary()])) };
    // @ts-expect-error -- a minimal RootState slice is enough for this selector.
    expect(selectKnownVariant('variant-1')(state)).toEqual(summary());
  });

  it('returns undefined for an unresolved variant, never a fabricated placeholder', () => {
    const state = { knownVariants: knownVariantsReducer(undefined, { type: '@@INIT' }) };
    // @ts-expect-error -- a minimal RootState slice is enough for this selector.
    expect(selectKnownVariant('unknown-variant')(state)).toBeUndefined();
  });

  it('selectKnownVariants exposes the whole index for a cart page checking every line at once', () => {
    const state = { knownVariants: knownVariantsReducer(undefined, variantsObserved([summary()])) };
    // @ts-expect-error -- a minimal RootState slice is enough for this selector.
    expect(selectKnownVariants(state)).toEqual({ 'variant-1': summary() });
  });
});
