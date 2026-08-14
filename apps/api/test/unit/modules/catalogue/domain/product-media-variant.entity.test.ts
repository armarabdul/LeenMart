import { describe, expect, it } from 'vitest';
import { UuidV7Generator } from '@leen-mart/domain-kit';
import { toVendorId } from '../../../../../src/modules/identity/index.js';
import {
  PRODUCT_MEDIA_VARIANT_FORMATS,
  PRODUCT_MEDIA_VARIANT_WIDTHS,
  ProductMediaVariant,
  type ProductMediaVariantFormat,
  type ProductMediaVariantWidth,
} from '../../../../../src/modules/catalogue/domain/entities/product-media-variant.entity.js';
import { InvalidProductMediaOperationError } from '../../../../../src/modules/catalogue/domain/errors/catalogue-errors.js';
import { toProductMediaId } from '../../../../../src/modules/catalogue/domain/value-objects/product-media-id.value-object.js';
import { toProductMediaVariantId } from '../../../../../src/modules/catalogue/domain/value-objects/product-media-variant-id.value-object.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-03-01T00:00:00.000Z');
const vendorId = toVendorId(ids.generate());
const mediaId = toProductMediaId(ids.generate());

interface Overrides {
  width?: ProductMediaVariantWidth;
  format?: ProductMediaVariantFormat;
  objectKey?: string;
  sizeBytes?: number;
}

const make = (overrides: Overrides = {}): ProductMediaVariant =>
  ProductMediaVariant.create({
    id: toProductMediaVariantId(ids.generate()),
    mediaId,
    vendorId,
    width: overrides.width ?? 800,
    format: overrides.format ?? 'WEBP',
    objectKey: overrides.objectKey ?? `product-media/${vendorId}/p/${mediaId}/800.webp`,
    sizeBytes: overrides.sizeBytes ?? 4096,
    now: NOW,
  });

const issueOf = (act: () => unknown): string => {
  try {
    act();
    return 'did not throw';
  } catch (error) {
    const failure = error as { details?: { field: string; issue: string }[] };
    return failure.details?.[0]?.issue ?? 'no detail';
  }
};

describe('ProductMediaVariant', () => {
  it('carries every field it was given', () => {
    const variant = make({ width: 1600, format: 'AVIF', sizeBytes: 9001 });
    expect(variant.mediaId).toBe(mediaId);
    expect(variant.vendorId).toBe(vendorId);
    expect(variant.width).toBe(1600);
    expect(variant.format).toBe('AVIF');
    expect(variant.sizeBytes).toBe(9001);
    expect(variant.createdAt).toEqual(NOW);
  });

  it('refuses a blank objectKey', () => {
    expect(() => make({ objectKey: '   ' })).toThrow(InvalidProductMediaOperationError);
    expect(issueOf(() => make({ objectKey: '' }))).toMatch(/must not be blank/i);
  });

  it('refuses a non-positive sizeBytes — a zero-byte variant is a failed encode, not a variant', () => {
    expect(issueOf(() => make({ sizeBytes: 0 }))).toMatch(/positive integer/i);
    expect(issueOf(() => make({ sizeBytes: -1 }))).toMatch(/positive integer/i);
  });

  it('refuses a non-integer sizeBytes', () => {
    expect(issueOf(() => make({ sizeBytes: 12.5 }))).toMatch(/positive integer/i);
  });

  it('has no mutating transition at all — it is written once', () => {
    const methods = Object.getOwnPropertyNames(ProductMediaVariant.prototype).filter(
      (name) => name !== 'constructor',
    );
    const descriptors = methods.filter(
      (name) =>
        typeof Object.getOwnPropertyDescriptor(ProductMediaVariant.prototype, name)?.get ===
        'undefined',
    );

    expect(descriptors).toEqual([]);
  });

  describe('the SDD 12.2 matrix (D-S2-6-F)', () => {
    it('declares exactly the four widths', () => {
      expect(PRODUCT_MEDIA_VARIANT_WIDTHS).toEqual([200, 400, 800, 1600]);
    });

    it('declares exactly the two formats', () => {
      expect(PRODUCT_MEDIA_VARIANT_FORMATS).toEqual(['WEBP', 'AVIF']);
    });

    it('is eight pairs — the count every other part of the pipeline is written against', () => {
      expect(PRODUCT_MEDIA_VARIANT_WIDTHS.length * PRODUCT_MEDIA_VARIANT_FORMATS.length).toBe(8);
    });

    it('accepts every pair in the matrix', () => {
      for (const width of PRODUCT_MEDIA_VARIANT_WIDTHS) {
        for (const format of PRODUCT_MEDIA_VARIANT_FORMATS) {
          expect(() => make({ width, format })).not.toThrow();
        }
      }
    });
  });

  describe('reconstitute', () => {
    it('restores a row exactly as given, with no revalidation', () => {
      const variant = ProductMediaVariant.reconstitute({
        id: toProductMediaVariantId(ids.generate()),
        mediaId,
        vendorId,
        width: 200,
        format: 'AVIF',
        objectKey: 'k',
        sizeBytes: 1,
        createdAt: NOW,
      });

      expect(variant.width).toBe(200);
      expect(variant.objectKey).toBe('k');
    });
  });
});
