import { describe, expect, it } from 'vitest';
import { UuidV7Generator } from '@leen-mart/domain-kit';
import { toVendorId } from '../../../../../src/modules/identity/index.js';
import { ProductMedia } from '../../../../../src/modules/catalogue/domain/entities/product-media.entity.js';
import { InvalidProductMediaOperationError } from '../../../../../src/modules/catalogue/domain/errors/catalogue-errors.js';
import { toProductId } from '../../../../../src/modules/catalogue/domain/value-objects/product-id.value-object.js';
import { toProductMediaId } from '../../../../../src/modules/catalogue/domain/value-objects/product-media-id.value-object.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-03-01T00:00:00.000Z');
const LATER = new Date('2026-03-02T00:00:00.000Z');
const vendorId = toVendorId(ids.generate());
const productId = toProductId(ids.generate());

interface Overrides {
  objectKey?: string;
  contentType?: string;
  sizeBytes?: number;
}

const make = (overrides: Overrides = {}): ProductMedia =>
  ProductMedia.create({
    id: toProductMediaId(ids.generate()),
    productId,
    vendorId,
    objectKey: overrides.objectKey ?? `product-media/${vendorId}/${productId}/x.jpg`,
    contentType: overrides.contentType ?? 'image/jpeg',
    sizeBytes: overrides.sizeBytes ?? 2048,
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

describe('ProductMedia', () => {
  it('starts AWAITING_UPLOAD and not deleted', () => {
    const media = make();
    expect(media.status).toBe('AWAITING_UPLOAD');
    expect(media.isDeleted).toBe(false);
    expect(media.deletedAt).toBeNull();
    expect(media.createdAt).toEqual(NOW);
    expect(media.updatedAt).toEqual(NOW);
  });

  it('carries the ids and shape fields it was given', () => {
    const media = make({ contentType: 'image/webp', sizeBytes: 4096 });
    expect(media.productId).toBe(productId);
    expect(media.vendorId).toBe(vendorId);
    expect(media.contentType).toBe('image/webp');
    expect(media.sizeBytes).toBe(4096);
  });

  it('refuses a blank objectKey', () => {
    expect(() => make({ objectKey: '   ' })).toThrow(InvalidProductMediaOperationError);
    expect(issueOf(() => make({ objectKey: '' }))).toMatch(/must not be blank/i);
  });

  it('refuses a blank contentType', () => {
    expect(issueOf(() => make({ contentType: '   ' }))).toMatch(/must not be blank/i);
  });

  it('refuses a contentType over 100 characters', () => {
    expect(issueOf(() => make({ contentType: 'x'.repeat(101) }))).toMatch(/at most 100/i);
  });

  it('accepts a contentType at exactly 100 characters', () => {
    expect(() => make({ contentType: 'x'.repeat(100) })).not.toThrow();
  });

  it('refuses a non-positive sizeBytes', () => {
    expect(issueOf(() => make({ sizeBytes: 0 }))).toMatch(/positive integer/i);
    expect(issueOf(() => make({ sizeBytes: -1 }))).toMatch(/positive integer/i);
  });

  it('refuses a non-integer sizeBytes', () => {
    expect(issueOf(() => make({ sizeBytes: 1.5 }))).toMatch(/positive integer/i);
  });

  it('carries no filename, caption, position or dimensions (S2-6 inspection R5) — none of these fields exist to set', () => {
    const media = make();
    expect(Object.getOwnPropertyNames(ProductMedia.prototype)).not.toEqual(
      expect.arrayContaining(['filename', 'caption', 'position', 'width', 'height']),
    );
    expect((media as unknown as Record<string, unknown>).filename).toBeUndefined();
  });

  describe('completeUpload', () => {
    it('moves AWAITING_UPLOAD to PROCESSING', () => {
      const completed = make().completeUpload(LATER);
      expect(completed.status).toBe('PROCESSING');
      expect(completed.updatedAt).toEqual(LATER);
    });

    it('refuses a media item that is already PROCESSING', () => {
      const processing = make().completeUpload(NOW);
      expect(issueOf(() => processing.completeUpload(LATER))).toMatch(/must be AWAITING_UPLOAD/i);
    });

    it('refuses on a deleted media item', () => {
      const deleted = make().softDelete(NOW);
      expect(issueOf(() => deleted.completeUpload(LATER))).toMatch(/deleted/i);
    });
  });

  describe('softDelete', () => {
    it('stamps deletedAt and reports itself deleted', () => {
      const deleted = make().softDelete(LATER);
      expect(deleted.deletedAt).toEqual(LATER);
      expect(deleted.isDeleted).toBe(true);
      expect(deleted.updatedAt).toEqual(LATER);
    });

    it('deletes from PROCESSING too — there is no status this is refused from', () => {
      const processing = make().completeUpload(NOW);
      expect(() => processing.softDelete(LATER)).not.toThrow();
    });

    it('refuses every further operation once deleted', () => {
      const deleted = make().softDelete(NOW);
      expect(issueOf(() => deleted.completeUpload(LATER))).toMatch(/deleted/i);
      expect(issueOf(() => deleted.softDelete(LATER))).toMatch(/deleted/i);
    });
  });

  describe('reconstitute', () => {
    it('restores a row exactly as given, with no revalidation', () => {
      const media = ProductMedia.reconstitute({
        id: toProductMediaId(ids.generate()),
        productId,
        vendorId,
        objectKey: 'product-media/x/y/z.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 1024,
        status: 'PROCESSING',
        createdAt: NOW,
        updatedAt: LATER,
        deletedAt: null,
      });
      expect(media.status).toBe('PROCESSING');
      expect(media.updatedAt).toEqual(LATER);
    });
  });
});
