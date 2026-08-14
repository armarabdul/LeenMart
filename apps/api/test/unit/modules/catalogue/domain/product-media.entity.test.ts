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

  describe('markReady (S2-6b)', () => {
    it('moves PROCESSING to READY', () => {
      const ready = make().completeUpload(NOW).markReady(LATER);
      expect(ready.status).toBe('READY');
      expect(ready.failureReason).toBeNull();
      expect(ready.updatedAt).toEqual(LATER);
    });

    it('refuses from AWAITING_UPLOAD — a job may not skip the pipeline', () => {
      expect(issueOf(() => make().markReady(LATER))).toMatch(/must be PROCESSING/i);
    });

    it('refuses from READY — a late duplicate cannot re-finish a finished item', () => {
      const ready = make().completeUpload(NOW).markReady(NOW);
      expect(issueOf(() => ready.markReady(LATER))).toMatch(/must be PROCESSING/i);
    });

    it('refuses from FAILED — the route back is retryProcessing, not straight to READY', () => {
      const failed = make().completeUpload(NOW).markFailed('DECODE_FAILED', NOW);
      expect(issueOf(() => failed.markReady(LATER))).toMatch(/must be PROCESSING/i);
    });

    it('refuses on a deleted media item', () => {
      const deleted = make().completeUpload(NOW).softDelete(NOW);
      expect(issueOf(() => deleted.markReady(LATER))).toMatch(/deleted/i);
    });
  });

  describe('markFailed (S2-6b)', () => {
    it('moves PROCESSING to FAILED and records the code', () => {
      const failed = make().completeUpload(NOW).markFailed('SVG_REJECTED', LATER);
      expect(failed.status).toBe('FAILED');
      expect(failed.failureReason).toBe('SVG_REJECTED');
      expect(failed.updatedAt).toEqual(LATER);
    });

    it('refuses from AWAITING_UPLOAD', () => {
      expect(issueOf(() => make().markFailed('PROCESSING_ERROR', LATER))).toMatch(
        /must be PROCESSING/i,
      );
    });

    it('refuses from READY — processing never demotes a finished item', () => {
      const ready = make().completeUpload(NOW).markReady(NOW);
      expect(issueOf(() => ready.markFailed('PROCESSING_ERROR', LATER))).toMatch(
        /must be PROCESSING/i,
      );
    });

    it('refuses a reason longer than the column allows', () => {
      const processing = make().completeUpload(NOW);
      expect(
        issueOf(() => processing.markFailed('x'.repeat(65) as 'PROCESSING_ERROR', LATER)),
      ).toMatch(/at most 64/i);
    });

    it('refuses on a deleted media item', () => {
      const deleted = make().completeUpload(NOW).softDelete(NOW);
      expect(issueOf(() => deleted.markFailed('PROCESSING_ERROR', LATER))).toMatch(/deleted/i);
    });
  });

  describe('retryProcessing (S2-6b)', () => {
    it('moves FAILED back to PROCESSING and clears the prior reason', () => {
      const retried = make()
        .completeUpload(NOW)
        .markFailed('PROCESSING_ERROR', NOW)
        .retryProcessing(LATER);
      expect(retried.status).toBe('PROCESSING');
      expect(retried.failureReason).toBeNull();
      expect(retried.updatedAt).toEqual(LATER);
    });

    it('can then reach READY — a retry is a genuine second chance, not a dead end', () => {
      const ready = make()
        .completeUpload(NOW)
        .markFailed('PROCESSING_ERROR', NOW)
        .retryProcessing(NOW)
        .markReady(LATER);
      expect(ready.status).toBe('READY');
    });

    it('refuses from PROCESSING — there is nothing to retry', () => {
      const processing = make().completeUpload(NOW);
      expect(issueOf(() => processing.retryProcessing(LATER))).toMatch(/must be FAILED/i);
    });

    it('refuses from READY', () => {
      const ready = make().completeUpload(NOW).markReady(NOW);
      expect(issueOf(() => ready.retryProcessing(LATER))).toMatch(/must be FAILED/i);
    });

    it('refuses on a deleted media item', () => {
      const deleted = make().completeUpload(NOW).markFailed('DECODE_FAILED', NOW).softDelete(NOW);
      expect(issueOf(() => deleted.retryProcessing(LATER))).toMatch(/deleted/i);
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
        failureReason: null,
        createdAt: NOW,
        updatedAt: LATER,
        deletedAt: null,
      });
      expect(media.status).toBe('PROCESSING');
      expect(media.updatedAt).toEqual(LATER);
    });
  });
});
