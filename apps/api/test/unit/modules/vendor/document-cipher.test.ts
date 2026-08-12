import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { AesGcmDocumentCipher } from '../../../../src/modules/vendor/infrastructure/crypto/aes-gcm-document-cipher.js';
import {
  encodeDocumentEncryptionContext,
  type DocumentEncryptionContext,
} from '../../../../src/modules/vendor/application/ports/document-cipher.port.js';
import { toVendorId } from '../../../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';
import { toKycId } from '../../../../src/modules/vendor/domain/value-objects/kyc-id.value-object.js';

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

const key = (): Buffer => randomBytes(32);

const context = (
  overrides: Partial<DocumentEncryptionContext> = {},
): DocumentEncryptionContext => ({
  vendorId: toVendorId('00000000-0000-7000-8000-0000000000a1'),
  kycId: toKycId('00000000-0000-7000-8000-0000000000a2'),
  documentType: 'PAN',
  ...overrides,
});

describe('AesGcmDocumentCipher', () => {
  const cipher = new AesGcmDocumentCipher();

  describe('round trip', () => {
    it('decrypts what it encrypted', () => {
      const plaintext = Buffer.from('a genuinely uploaded PDF, in spirit', 'utf8');
      const k = key();
      const ctx = context();

      const ciphertext = cipher.encrypt(plaintext, k, ctx);
      const decrypted = cipher.decrypt(ciphertext, k, ctx);

      expect(decrypted).toEqual(plaintext);
    });

    it('round-trips empty plaintext', () => {
      const k = key();
      const ctx = context();

      const ciphertext = cipher.encrypt(Buffer.alloc(0), k, ctx);
      const decrypted = cipher.decrypt(ciphertext, k, ctx);

      expect(decrypted).toEqual(Buffer.alloc(0));
      // Framing is still exactly IV + tag, no ciphertext body, for an empty input.
      expect(ciphertext).toHaveLength(IV_LENGTH + AUTH_TAG_LENGTH);
    });

    it('round-trips arbitrary binary bytes, not just text', () => {
      const plaintext = randomBytes(4096); // stands in for a real PDF's non-UTF8 bytes
      const k = key();
      const ctx = context();

      const decrypted = cipher.decrypt(cipher.encrypt(plaintext, k, ctx), k, ctx);

      expect(decrypted).toEqual(plaintext);
    });

    it('round-trips a payload large enough to exercise multiple internal cipher blocks', () => {
      const plaintext = randomBytes(256 * 1024); // 256 KB — well past one 16-byte AES block
      const k = key();
      const ctx = context();

      const decrypted = cipher.decrypt(cipher.encrypt(plaintext, k, ctx), k, ctx);

      expect(decrypted).toEqual(plaintext);
    });
  });

  describe('framing', () => {
    it('produces exactly IV(12) || AUTH_TAG(16) || CIPHERTEXT', () => {
      const plaintext = Buffer.from('framing check', 'utf8');
      const k = key();

      const ciphertext = cipher.encrypt(plaintext, k, context());

      expect(ciphertext).toHaveLength(IV_LENGTH + AUTH_TAG_LENGTH + plaintext.length);
      // GCM is a stream-cipher mode: ciphertext length equals plaintext length exactly.
      const body = ciphertext.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
      expect(body).toHaveLength(plaintext.length);
    });

    it('generates a fresh random IV every call — two encryptions of identical plaintext differ', () => {
      const plaintext = Buffer.from('same bytes, every time', 'utf8');
      const k = key();
      const ctx = context();

      const first = cipher.encrypt(plaintext, k, ctx);
      const second = cipher.encrypt(plaintext, k, ctx);

      expect(first.subarray(0, IV_LENGTH)).not.toEqual(second.subarray(0, IV_LENGTH));
      expect(first).not.toEqual(second);
      // Both still decrypt to the same plaintext, independently.
      expect(cipher.decrypt(first, k, ctx)).toEqual(plaintext);
      expect(cipher.decrypt(second, k, ctx)).toEqual(plaintext);
    });
  });

  describe('fails closed', () => {
    it('rejects ciphertext shorter than the minimum IV+tag framing', () => {
      expect(() => cipher.decrypt(Buffer.alloc(10), key(), context())).toThrow();
    });

    it('rejects ciphertext truncated after a valid framing prefix', () => {
      const full = cipher.encrypt(Buffer.from('truncate me', 'utf8'), key(), context());
      const truncated = full.subarray(0, full.length - 4);

      expect(() => cipher.decrypt(truncated, key(), context())).toThrow();
    });

    it('rejects a tampered authentication tag', () => {
      const k = key();
      const ctx = context();
      const ciphertext = cipher.encrypt(Buffer.from('tag tamper', 'utf8'), k, ctx);
      ciphertext[IV_LENGTH] = (ciphertext[IV_LENGTH] ?? 0) ^ 0xff;

      expect(() => cipher.decrypt(ciphertext, k, ctx)).toThrow();
    });

    it('rejects tampered ciphertext bytes', () => {
      const k = key();
      const ctx = context();
      const ciphertext = cipher.encrypt(Buffer.from('body tamper', 'utf8'), k, ctx);
      const lastByte = ciphertext.length - 1;
      ciphertext[lastByte] = (ciphertext[lastByte] ?? 0) ^ 0xff;

      expect(() => cipher.decrypt(ciphertext, k, ctx)).toThrow();
    });

    it('rejects the wrong key', () => {
      const ctx = context();
      const ciphertext = cipher.encrypt(Buffer.from('wrong key', 'utf8'), key(), ctx);

      expect(() => cipher.decrypt(ciphertext, key(), ctx)).toThrow();
    });

    it('rejects a wrong vendorId in the context', () => {
      const k = key();
      const ciphertext = cipher.encrypt(Buffer.from('vendor bound', 'utf8'), k, context());
      const wrongVendor = context({ vendorId: toVendorId('00000000-0000-7000-8000-0000000000ff') });

      expect(() => cipher.decrypt(ciphertext, k, wrongVendor)).toThrow();
    });

    it('rejects a wrong kycId in the context', () => {
      const k = key();
      const ciphertext = cipher.encrypt(Buffer.from('kyc bound', 'utf8'), k, context());
      const wrongKyc = context({ kycId: toKycId('00000000-0000-7000-8000-0000000000fe') });

      expect(() => cipher.decrypt(ciphertext, k, wrongKyc)).toThrow();
    });

    it('rejects a wrong documentType in the context', () => {
      const k = key();
      const ciphertext = cipher.encrypt(Buffer.from('type bound', 'utf8'), k, context());
      const wrongType = context({ documentType: 'GSTIN' });

      expect(() => cipher.decrypt(ciphertext, k, wrongType)).toThrow();
    });

    it('never returns partial plaintext when authentication fails', () => {
      const k = key();
      const ctx = context();
      const plaintext = Buffer.from('must never leak, even partially', 'utf8');
      const ciphertext = cipher.encrypt(plaintext, k, ctx);
      ciphertext[ciphertext.length - 1] = (ciphertext[ciphertext.length - 1] ?? 0) ^ 0xff;

      let observed: Buffer | undefined;
      try {
        observed = cipher.decrypt(ciphertext, k, ctx);
      } catch {
        // expected
      }

      expect(observed).toBeUndefined();
    });
  });

  describe('key length', () => {
    it('rejects an encryption key that is not 32 bytes', () => {
      expect(() => cipher.encrypt(Buffer.from('x'), randomBytes(16), context())).toThrow(
        /exactly 32 bytes/,
      );
    });

    it('rejects a decryption key that is not 32 bytes', () => {
      const ciphertext = cipher.encrypt(Buffer.from('x'), key(), context());
      expect(() => cipher.decrypt(ciphertext, randomBytes(16), context())).toThrow(
        /exactly 32 bytes/,
      );
    });
  });
});

describe('encodeDocumentEncryptionContext', () => {
  it('is deterministic — the same context always encodes to the same bytes', () => {
    const ctx = context();

    expect(encodeDocumentEncryptionContext(ctx)).toEqual(encodeDocumentEncryptionContext(ctx));
  });

  it('produces different bytes for different vendorId, kycId, or documentType', () => {
    const base = encodeDocumentEncryptionContext(context());

    expect(
      encodeDocumentEncryptionContext(
        context({ vendorId: toVendorId('00000000-0000-7000-8000-0000000000b1') }),
      ),
    ).not.toEqual(base);
    expect(
      encodeDocumentEncryptionContext(
        context({ kycId: toKycId('00000000-0000-7000-8000-0000000000b2') }),
      ),
    ).not.toEqual(base);
    expect(
      encodeDocumentEncryptionContext(context({ documentType: 'BANK_ACCOUNT_PROOF' })),
    ).not.toEqual(base);
  });

  it('names every field explicitly, not just concatenating values', () => {
    // Proves the representation cannot be confused by field-boundary shifting
    // (e.g. a vendorId ending where a kycId's leading characters could,
    // without the field names, look identical to a different split).
    const encoded = encodeDocumentEncryptionContext(context()).toString('utf8');

    expect(encoded).toContain('vendorId=');
    expect(encoded).toContain('kycId=');
    expect(encoded).toContain('documentType=');
  });
});
