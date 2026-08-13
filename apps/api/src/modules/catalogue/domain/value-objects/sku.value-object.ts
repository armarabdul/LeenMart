import type { Brand } from '@leen-mart/domain-kit';

export type Sku = Brand<string, 'Sku'>;

export const SKU_MAX_LENGTH = 64;

/**
 * A vendor's own catalogue code for one variant (ASM-15, S2-3 D-5).
 *
 * Deliberately no format regex and no fixed character set — the SDD never
 * specifies one, unlike `CategorySlug`'s SDD-stated pattern, and D-5 is
 * explicit that inventing one here would be exactly the kind of unfounded
 * rule this codebase avoids. The only requirements are the ones actually
 * stated: non-empty after trimming, and within the column's length.
 *
 * Branded anyway, despite the light validation: it is still a stable
 * business identifier — arbitrated by `idx_product_variants_vendor_sku` the
 * same way `CategorySlug` is arbitrated by its own unique index — and
 * branding is what stops it being passed where a `name` or a `productId` is
 * expected.
 *
 * `isSku` checks an already-trimmed value — `toSku` is the normal entry point.
 */
export const isSku = (value: string): value is Sku =>
  value.length > 0 && value.length <= SKU_MAX_LENGTH;

export const toSku = (value: string): Sku => {
  const trimmed = value.trim();
  if (!isSku(trimmed)) {
    throw new TypeError(
      `Not a valid SKU: must be non-empty and at most ${SKU_MAX_LENGTH} characters after trimming.`,
    );
  }
  return trimmed;
};
