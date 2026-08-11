import { describe, expect, it } from 'vitest';
import { KycDocument } from '../../../../../src/modules/vendor/domain/entities/kyc-document.entity.js';
import { KycDocumentType } from '../../../../../src/modules/vendor/domain/value-objects/kyc-document-type.value-object.js';
import { toKycDocumentId } from '../../../../../src/modules/vendor/domain/value-objects/kyc-document-id.value-object.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const LATER = new Date('2026-01-01T00:05:00.000Z');
const id = toKycDocumentId('00000000-0000-7000-8000-00000000d001');
const WRAPPED = Buffer.from('wrapped-data-key-material');

const build = (
  overrides: Partial<Parameters<typeof KycDocument.awaitUpload>[0]> = {},
): KycDocument =>
  KycDocument.awaitUpload({
    id,
    type: KycDocumentType.PAN,
    objectKey: 'vendor/abc/pan.enc',
    wrappedDataKey: WRAPPED,
    contentType: 'application/pdf',
    sizeBytes: 2048,
    now: NOW,
    ...overrides,
  });

describe('KycDocument', () => {
  describe('upload intent', () => {
    it('records the object reference and its wrapped key (SDD 12.3)', () => {
      const document = build();

      expect(document.objectKey).toBe('vendor/abc/pan.enc');
      expect(document.wrappedDataKey.equals(WRAPPED)).toBe(true);
      expect(document.contentType).toBe('application/pdf');
      expect(document.sizeBytes).toBe(2048);
      expect(document.createdAt).toEqual(NOW);
    });

    it('starts awaiting upload — a reserved key is not yet a document', () => {
      const document = build();

      expect(document.status).toBe('AWAITING_UPLOAD');
      expect(document.isUploaded()).toBe(false);
      expect(document.uploadedAt).toBeNull();
    });

    it.each([
      ['an empty object key', { objectKey: '   ' }],
      ['an empty wrapped key', { wrappedDataKey: Buffer.alloc(0) }],
      ['an empty content type', { contentType: ' ' }],
      ['a zero size', { sizeBytes: 0 }],
      ['a negative size', { sizeBytes: -1 }],
      ['a fractional size', { sizeBytes: 1.5 }],
    ])('refuses %s', (_label, overrides) => {
      expect(() => build(overrides)).toThrow(/not valid/);
    });
  });

  describe('upload completion', () => {
    it('marks the document uploaded and stamps the time', () => {
      const uploaded = build().markUploaded(LATER);

      expect(uploaded.status).toBe('UPLOADED');
      expect(uploaded.isUploaded()).toBe(true);
      expect(uploaded.uploadedAt).toEqual(LATER);
    });

    it('never mutates the document it was called on', () => {
      const document = build();

      document.markUploaded(LATER);

      expect(document.status).toBe('AWAITING_UPLOAD');
    });

    it('leaves the object reference and key untouched', () => {
      const uploaded = build().markUploaded(LATER);

      expect(uploaded.objectKey).toBe('vendor/abc/pan.enc');
      expect(uploaded.wrappedDataKey.equals(WRAPPED)).toBe(true);
    });
  });

  describe('reconstitution', () => {
    it('rehydrates a persisted row without re-validating it', () => {
      // A row written years ago under different rules must still load.
      const rehydrated = KycDocument.reconstitute({
        id,
        type: KycDocumentType.GSTIN,
        objectKey: '',
        wrappedDataKey: Buffer.alloc(0),
        contentType: '',
        sizeBytes: 0,
        status: 'UPLOADED',
        uploadedAt: LATER,
        createdAt: NOW,
      });

      expect(rehydrated.isUploaded()).toBe(true);
    });
  });

  describe('security', () => {
    it('redacts the wrapped data key when serialised', () => {
      // Without this, one `logger.info({ document })` puts wrapped keys into
      // log storage under a field name the redaction allowlist cannot predict.
      const serialised = JSON.stringify(build());

      expect(serialised).not.toContain('wrapped-data-key-material');
      expect(serialised).toContain('[REDACTED]');
    });

    it('redacts it after upload completion too', () => {
      expect(JSON.stringify(build().markUploaded(LATER))).not.toContain(
        'wrapped-data-key-material',
      );
    });

    it('redacts it when nested inside another structure', () => {
      const serialised = JSON.stringify({ context: { documents: [build()] } });

      expect(serialised).not.toContain('wrapped-data-key-material');
    });

    it('still exposes the metadata a reviewer needs', () => {
      const rendered = JSON.parse(JSON.stringify(build())) as Record<string, unknown>;

      expect(rendered.type).toBe('PAN');
      expect(rendered.objectKey).toBe('vendor/abc/pan.enc');
      expect(rendered.status).toBe('AWAITING_UPLOAD');
    });

    it('holds no document bytes at all — files never reach the API tier (SDD 12.2)', () => {
      const rendered = JSON.parse(JSON.stringify(build())) as Record<string, unknown>;

      expect(Object.keys(rendered)).not.toContain('content');
      expect(Object.keys(rendered)).not.toContain('body');
      expect(Object.keys(rendered)).not.toContain('bytes');
    });
  });
});
