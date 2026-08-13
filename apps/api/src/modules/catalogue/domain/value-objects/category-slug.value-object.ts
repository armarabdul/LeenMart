import type { Brand } from '@leen-mart/domain-kit';

export type CategorySlug = Brand<string, 'CategorySlug'>;

/**
 * Lowercase, hyphen-separated, no leading, trailing or doubled hyphen — the
 * same expression `chk_categories_slug_format` enforces in PostgreSQL, so the
 * aggregate and the database agree by construction rather than by comment.
 */
export const CATEGORY_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const CATEGORY_SLUG_MAX_LENGTH = 140;

/**
 * A category's stable public URL key (S2-2 D-C13).
 *
 * Branded rather than a plain `string` so it cannot be passed where a `name`
 * is expected, or vice versa — the two are adjacent `VarChar` columns holding
 * human text, which is exactly the shape of mix-up SDD 24.3 introduces branded
 * types to prevent.
 *
 * **Immutable once assigned.** The aggregate offers no way to change it, and
 * `updateCategoryRequestSchema` refuses the field outright: a slug that can
 * change is not a stable URL, and silently breaking every inbound link to a
 * category is not something an admin edit should be able to do by accident.
 */
export const isCategorySlug = (value: string): value is CategorySlug =>
  value.length > 0 && value.length <= CATEGORY_SLUG_MAX_LENGTH && CATEGORY_SLUG_PATTERN.test(value);

export const toCategorySlug = (value: string): CategorySlug => {
  if (!isCategorySlug(value)) {
    throw new TypeError(`Not a valid category slug: "${value}"`);
  }
  return value;
};
