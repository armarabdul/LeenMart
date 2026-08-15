import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { MoneyDto } from '@leen-mart/contracts';
import type { RootState } from '@/app/store';

/**
 * The minimum a cart line item needs to display itself — never the full
 * `PublicProductDetail`/`PublicProductVariant` payload, which stays in RTK
 * Query's own cache under `product.api`.
 */
export interface KnownVariantSummary {
  readonly variantId: string;
  readonly productId: string;
  readonly productName: string;
  readonly variantName: string;
  readonly price: MoneyDto;
  readonly unitOfMeasure: string;
  readonly quantityStep: number;
  readonly available: number;
}

export interface KnownVariantsState {
  readonly byVariantId: Readonly<Record<string, KnownVariantSummary>>;
}

const initialState: KnownVariantsState = { byVariantId: {} };

/**
 * Bridges a real backend gap (see the product-detail discovery report): a
 * cart item carries only `variantId`, and no public endpoint resolves a bare
 * `variantId` back to its product. There is no reverse index into RTK
 * Query's own cache (which is keyed by product id, the argument
 * `getProductDetail` was called with), so this slice is the smallest
 * possible bridge — observed variant summaries only, keyed by the one field
 * a cart item actually has.
 *
 * Populated by `features/product/product.api.ts` whenever a product detail
 * fetch succeeds (every variant of the viewed product, not just the selected
 * one). Read by `features/cart` to resolve a cart item's display data. Both
 * sides import this from `shared/`, never from each other, preserving the
 * feature-isolation rule `session.slice.ts` already establishes for the same
 * reason.
 *
 * Deliberately not persisted and not retried: if a variant was never
 * observed this session (a returning customer opening Cart cold, an item
 * added on another device), there is nothing here to find, and the cart UI
 * falls back to an honest "unavailable" state rather than fabricating one.
 */
const knownVariantsSlice = createSlice({
  name: 'knownVariants',
  initialState,
  reducers: {
    variantsObserved: (state, action: PayloadAction<readonly KnownVariantSummary[]>): void => {
      for (const summary of action.payload) {
        state.byVariantId[summary.variantId] = summary;
      }
    },
  },
});

export const { variantsObserved } = knownVariantsSlice.actions;
export const knownVariantsReducer = knownVariantsSlice.reducer;

export const selectKnownVariant =
  (variantId: string) =>
  (state: RootState): KnownVariantSummary | undefined =>
    state.knownVariants.byVariantId[variantId];

/** The whole index — for a cart page that needs to check every line item's resolution status at once. */
export const selectKnownVariants = (
  state: RootState,
): Readonly<Record<string, KnownVariantSummary>> => state.knownVariants.byVariantId;
