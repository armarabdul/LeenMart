import { describe, expect, it } from 'vitest';
import { UuidV7Generator, type Logger, type LogContext } from '@leen-mart/domain-kit';
import { randomBytes } from 'node:crypto';
import { AccessKycDocumentUseCase } from '../../../../../src/modules/vendor/application/use-cases/access-kyc-document.use-case.js';
import type {
  KycDocumentAccessQueryPort,
  KycDocumentAccessRecord,
} from '../../../../../src/modules/vendor/application/ports/kyc-document-access-query.port.js';
import type {
  ObjectStore,
  PresignedDownload,
  PresignedUpload,
  StoredObject,
  TemporaryObject,
} from '../../../../../src/modules/media/index.js';
import type {
  DataKeyCipher,
  GeneratedDataKey,
} from '../../../../../src/modules/vendor/application/ports/data-key-cipher.port.js';
import type {
  DocumentCipher,
  DocumentEncryptionContext,
} from '../../../../../src/modules/vendor/application/ports/document-cipher.port.js';
import {
  InvalidKycOperationError,
  KycDocumentNotFoundError,
} from '../../../../../src/modules/vendor/domain/errors/kyc-errors.js';
import { VENDOR_AUDIT_ACTIONS } from '../../../../../src/modules/vendor/domain/audit-actions.js';
import { toKycDocumentId } from '../../../../../src/modules/vendor/domain/value-objects/kyc-document-id.value-object.js';
import { toKycId } from '../../../../../src/modules/vendor/domain/value-objects/kyc-id.value-object.js';
import { toSessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toVendorId } from '../../../../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';
import type { Principal } from '../../../../../src/modules/identity/application/ports/principal.js';
import { FailingAuditWriter, RecordingAuditWriter } from '../../identity/application/fakes.js';

const ids = new UuidV7Generator();
const EXPIRES = new Date('2026-04-01T00:01:00.000Z');

const kycId = toKycId(ids.generate());
const documentId = toKycDocumentId(ids.generate());
const vendorId = toVendorId(ids.generate());
const admin = toUserId(ids.generate());

const principal: Principal = {
  userId: admin,
  sessionId: toSessionId(ids.generate()),
  role: 'RISK_ANALYST',
};

const objectKey = `vendor/${vendorId}/${kycId}/PAN.enc`;
const PLAINTEXT = Buffer.from('the actual PDF bytes, in spirit');
const DATA_KEY = randomBytes(32);

/**
 * A `DocumentCipher` fake that genuinely checks key and context — not the
 * real AES-256-GCM (that belongs to `AesGcmDocumentCipher`'s own tests,
 * `document-cipher.test.ts`, and reaching for it here would import an
 * infrastructure adapter into an application-layer test, which the
 * architecture lint forbids). What this use case's own tests need to prove
 * is that it builds the right context and key and propagates a rejection —
 * not that AEAD authentication itself is sound.
 */
interface FakeSealedPayload {
  readonly keyHex: string;
  readonly vendorId: string;
  readonly kycId: string;
  readonly documentType: string;
  readonly plaintextBase64: string;
}

class CheckedFakeDocumentCipher implements DocumentCipher {
  encrypt(): Buffer {
    throw new Error('not used by this use case');
  }

  decrypt(ciphertext: Buffer, key: Buffer, context: DocumentEncryptionContext): Buffer {
    let payload: FakeSealedPayload;
    try {
      payload = JSON.parse(ciphertext.toString('utf8')) as FakeSealedPayload;
    } catch {
      throw new Error('malformed ciphertext');
    }
    if (
      typeof payload.keyHex !== 'string' ||
      payload.keyHex !== key.toString('hex') ||
      payload.vendorId !== context.vendorId ||
      payload.kycId !== context.kycId ||
      payload.documentType !== context.documentType
    ) {
      throw new Error('authentication failed');
    }
    return Buffer.from(payload.plaintextBase64, 'base64');
  }
}

const documentCipher = new CheckedFakeDocumentCipher();

/** The fixture "encryption" this fake's `decrypt` above reverses. */
const sealFixture = (plaintext: Buffer, key: Buffer, context: DocumentEncryptionContext): Buffer =>
  Buffer.from(
    JSON.stringify({
      keyHex: key.toString('hex'),
      vendorId: context.vendorId,
      kycId: context.kycId,
      documentType: context.documentType,
      plaintextBase64: plaintext.toString('base64'),
    } satisfies FakeSealedPayload),
    'utf8',
  );

const REAL_CONTEXT: DocumentEncryptionContext = { vendorId, kycId, documentType: 'PAN' };
const CIPHERTEXT = sealFixture(PLAINTEXT, DATA_KEY, REAL_CONTEXT);

const recordFor = (overrides: Partial<KycDocumentAccessRecord> = {}): KycDocumentAccessRecord => ({
  id: documentId,
  kycId,
  vendorId,
  type: 'PAN',
  objectKey,
  wrappedDataKey: Buffer.from('wrapped-key-material'),
  status: 'UPLOADED',
  contentType: 'application/pdf',
  ...overrides,
});

class StubDocumentAccessQuery implements KycDocumentAccessQueryPort {
  constructor(private readonly record: KycDocumentAccessRecord | null) {}

  findForAccess(): Promise<KycDocumentAccessRecord | null> {
    return Promise.resolve(this.record);
  }
}

/** Ignores `wrapped`/context entirely and always returns the one fixed key — this use case's own context handling is exercised through `CheckedFakeDocumentCipher` above, not through this fake. */
class FixedDataKeyCipher implements DataKeyCipher {
  constructor(private readonly key: Buffer) {}

  generateDataKey(): Promise<GeneratedDataKey> {
    throw new Error('not used by this use case');
  }

  unwrap(): Promise<Buffer> {
    return Promise.resolve(Buffer.from(this.key));
  }

  shred(plaintext: Buffer): void {
    plaintext.fill(0);
  }
}

class RecordingObjectStore implements ObjectStore {
  readonly objects = new Map<string, Buffer>();
  readonly temporaryWrites: { bytes: Buffer; contentType: string }[] = [];
  readonly deletedKeys: string[] = [];
  readonly presignedKeys: string[] = [];
  writeTemporaryObjectError: Error | null = null;
  deleteError: Error | null = null;
  private tempSeq = 0;

  seed(key: string, body: Buffer): void {
    this.objects.set(key, body);
  }

  presignPut(): Promise<PresignedUpload> {
    throw new Error('not used by this use case');
  }

  presignGet(key: string): Promise<PresignedDownload> {
    this.presignedKeys.push(key);
    return Promise.resolve({ url: `https://store.example/${key}?signed=1`, expiresAt: EXPIRES });
  }

  head(): Promise<StoredObject | null> {
    throw new Error('not used by this use case');
  }

  getObject(key: string): Promise<Buffer | null> {
    return Promise.resolve(this.objects.get(key) ?? null);
  }

  writeTemporaryObject(bytes: Buffer, contentType: string): Promise<TemporaryObject> {
    this.temporaryWrites.push({ bytes, contentType });
    if (this.writeTemporaryObjectError) {
      return Promise.reject(this.writeTemporaryObjectError);
    }
    this.tempSeq += 1;
    const key = `kyc-temp-delivery/fake-${String(this.tempSeq)}`;
    this.objects.set(key, bytes);
    return Promise.resolve({ key });
  }

  delete(key: string): Promise<void> {
    this.deletedKeys.push(key);
    if (this.deleteError) {
      return Promise.reject(this.deleteError);
    }
    this.objects.delete(key);
    return Promise.resolve();
  }
}

class RecordingLogger implements Logger {
  readonly errors: { context: LogContext; message: string }[] = [];

  fatal(): void {
    // Not asserted on by these tests — only `error` is.
  }

  warn(): void {
    // Not asserted on by these tests — only `error` is.
  }

  info(): void {
    // Not asserted on by these tests — only `error` is.
  }

  debug(): void {
    // Not asserted on by these tests — only `error` is.
  }

  trace(): void {
    // Not asserted on by these tests — only `error` is.
  }

  error(context: LogContext, message: string): void {
    this.errors.push({ context, message });
  }

  child(): Logger {
    return this;
  }
}

interface Harness {
  useCase: AccessKycDocumentUseCase;
  objectStore: RecordingObjectStore;
  auditWriter: RecordingAuditWriter;
  logger: RecordingLogger;
}

const setup = (
  options: {
    record?: KycDocumentAccessRecord | null;
    ciphertext?: Buffer;
    dataKeyCipher?: DataKeyCipher;
    auditWriter?: RecordingAuditWriter | FailingAuditWriter;
    writeTemporaryObjectError?: Error;
    deleteError?: Error;
  } = {},
): Harness => {
  const objectStore = new RecordingObjectStore();
  if (options.ciphertext !== null) {
    objectStore.seed(objectKey, options.ciphertext ?? CIPHERTEXT);
  }
  if (options.writeTemporaryObjectError) {
    objectStore.writeTemporaryObjectError = options.writeTemporaryObjectError;
  }
  if (options.deleteError) {
    objectStore.deleteError = options.deleteError;
  }
  const auditWriter = (options.auditWriter ?? new RecordingAuditWriter()) as RecordingAuditWriter;
  const logger = new RecordingLogger();

  return {
    useCase: new AccessKycDocumentUseCase({
      documentAccessQuery: new StubDocumentAccessQuery(
        options.record === undefined ? recordFor() : options.record,
      ),
      objectStore,
      dataKeyCipher: options.dataKeyCipher ?? new FixedDataKeyCipher(DATA_KEY),
      documentCipher,
      auditWriter,
      logger,
    }),
    objectStore,
    auditWriter,
    logger,
  };
};

const execute = (
  useCase: AccessKycDocumentUseCase,
): ReturnType<AccessKycDocumentUseCase['execute']> =>
  useCase.execute({ principal, kycId, documentId });

describe('AccessKycDocumentUseCase', () => {
  describe('successful decrypt and delivery', () => {
    it('returns a url and expiry, addressed to the temporary object', async () => {
      const { useCase, objectStore } = setup();

      const result = await execute(useCase);

      expect(result.kycId).toBe(kycId);
      expect(result.documentId).toBe(documentId);
      expect(result.type).toBe('PAN');
      expect(result.url).toBe(`https://store.example/${objectStore.presignedKeys[0]}?signed=1`);
      expect(result.expiresAt).toEqual(EXPIRES);
    });

    it('writes exactly one temporary object containing the original plaintext', async () => {
      const { useCase, objectStore } = setup();

      await execute(useCase);

      expect(objectStore.temporaryWrites).toHaveLength(1);
      expect(objectStore.temporaryWrites[0]?.bytes).toEqual(PLAINTEXT);
      expect(objectStore.temporaryWrites[0]?.contentType).toBe('application/pdf');
    });

    it('presigns only the temporary object, never the permanent objectKey', async () => {
      const { useCase, objectStore } = setup();

      await execute(useCase);

      expect(objectStore.presignedKeys).toHaveLength(1);
      expect(objectStore.presignedKeys[0]).not.toBe(objectKey);
      expect(objectStore.presignedKeys[0]).toMatch(/^kyc-temp-delivery\//);
    });

    it('never writes to, modifies, or deletes the permanent object', async () => {
      const { useCase, objectStore } = setup();
      const before = objectStore.objects.get(objectKey);

      await execute(useCase);

      expect(objectStore.objects.get(objectKey)).toEqual(before);
      expect(objectStore.deletedKeys).not.toContain(objectKey);
    });

    it('decrypts correctly when vendorId, kycId and documentType all match the original context', async () => {
      const { useCase, objectStore } = setup();

      await execute(useCase);

      expect(objectStore.temporaryWrites[0]?.bytes).toEqual(PLAINTEXT);
    });

    it('returns only the approved fields — no key material, object key or storage credentials', async () => {
      const { useCase } = setup();

      const result = await execute(useCase);

      expect(Object.keys(result).sort()).toEqual(
        ['documentId', 'expiresAt', 'kycId', 'type', 'url'].sort(),
      );
      const serialised = JSON.stringify(result);
      expect(serialised).not.toContain('wrapped-key-material');
      expect(serialised).not.toContain(objectKey);
      expect(serialised).not.toContain('secretAccessKey');
    });

    it('does not mutate shared state across repeated, independent accesses', async () => {
      const { useCase, objectStore, auditWriter } = setup();

      await execute(useCase);
      await execute(useCase);

      expect(objectStore.temporaryWrites).toHaveLength(2);
      expect(auditWriter.entries).toHaveLength(2);
      expect(objectStore.temporaryWrites[0]?.bytes).toEqual(objectStore.temporaryWrites[1]?.bytes);
    });
  });

  describe('wrong encryption context fails closed', () => {
    it('rejects when the record names a different vendorId than the ciphertext was encrypted under', async () => {
      const { useCase, objectStore } = setup({
        record: recordFor({ vendorId: toVendorId(ids.generate()) }),
      });

      await expect(execute(useCase)).rejects.toThrow();
      expect(objectStore.temporaryWrites).toHaveLength(0);
    });

    it('rejects when the record names a different kycId than the ciphertext was encrypted under', async () => {
      const { useCase, objectStore } = setup({
        record: recordFor({ kycId: toKycId(ids.generate()) }),
      });

      await expect(execute(useCase)).rejects.toThrow();
      expect(objectStore.temporaryWrites).toHaveLength(0);
    });

    it('rejects when the record names a different documentType than the ciphertext was encrypted under', async () => {
      const { useCase, objectStore } = setup({ record: recordFor({ type: 'GSTIN' }) });

      await expect(execute(useCase)).rejects.toThrow();
      expect(objectStore.temporaryWrites).toHaveLength(0);
    });
  });

  describe('malformed ciphertext fails closed', () => {
    it('rejects truncated ciphertext and writes no temporary object', async () => {
      const { useCase, objectStore } = setup({ ciphertext: CIPHERTEXT.subarray(0, 10) });

      await expect(execute(useCase)).rejects.toThrow();
      expect(objectStore.temporaryWrites).toHaveLength(0);
    });

    it('rejects tampered ciphertext and audits nothing', async () => {
      const tampered = Buffer.from(CIPHERTEXT);
      tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0xff;
      const { useCase, auditWriter } = setup({ ciphertext: tampered });

      await expect(execute(useCase)).rejects.toThrow();
      expect(auditWriter.entries).toHaveLength(0);
    });
  });

  describe('lookup and status failures', () => {
    it('reports a missing (kycId, documentId) pair as not found', async () => {
      const { useCase } = setup({ record: null });

      await expect(execute(useCase)).rejects.toBeInstanceOf(KycDocumentNotFoundError);
    });

    it('reports a missing permanent object as not found, despite an UPLOADED row', async () => {
      const { useCase, objectStore } = setup({ ciphertext: null as unknown as Buffer });

      await expect(execute(useCase)).rejects.toBeInstanceOf(KycDocumentNotFoundError);
      expect(objectStore.temporaryWrites).toHaveLength(0);
    });

    it('refuses an AWAITING_UPLOAD document before touching storage or crypto', async () => {
      const { useCase, objectStore, auditWriter } = setup({
        record: recordFor({ status: 'AWAITING_UPLOAD' }),
      });

      await expect(execute(useCase)).rejects.toBeInstanceOf(InvalidKycOperationError);
      expect(objectStore.temporaryWrites).toHaveLength(0);
      expect(auditWriter.entries).toHaveLength(0);
    });
  });

  describe('audit (KYC-7)', () => {
    it('records exactly one audit event on successful access', async () => {
      const { useCase, auditWriter } = setup();

      await execute(useCase);

      expect(auditWriter.entries).toHaveLength(1);
    });

    it('records the document-accessed action, actor and kyc identity', async () => {
      const { useCase, auditWriter } = setup();

      await execute(useCase);

      const [entry] = auditWriter.entries;
      expect(entry?.action).toBe(VENDOR_AUDIT_ACTIONS.KYC_DOCUMENT_ACCESSED);
      expect(entry?.entityType).toBe('VendorKyc');
      expect(entry?.entityId).toBe(kycId);
      expect(entry?.actorId).toBe(admin);
      expect(entry?.actorRole).toBe('RISK_ANALYST');
    });

    it('keeps plaintext, keys and object keys out of the audit payload', async () => {
      const { useCase, auditWriter } = setup();

      await execute(useCase);

      const serialised = JSON.stringify(auditWriter.entries[0]);
      expect(serialised).not.toContain(PLAINTEXT.toString());
      expect(serialised).not.toContain('wrapped-key-material');
      expect(serialised).not.toContain(objectKey);
    });

    it('propagates an audit failure instead of returning a url', async () => {
      const { useCase } = setup({ auditWriter: new FailingAuditWriter() });

      await expect(execute(useCase)).rejects.toThrow(/audit log unavailable/);
    });

    it('deletes the temporary object when the audit write fails', async () => {
      const objectStore = new RecordingObjectStore();
      objectStore.seed(objectKey, CIPHERTEXT);
      const useCase = new AccessKycDocumentUseCase({
        documentAccessQuery: new StubDocumentAccessQuery(recordFor()),
        objectStore,
        dataKeyCipher: new FixedDataKeyCipher(DATA_KEY),
        documentCipher,
        auditWriter: new FailingAuditWriter(),
        logger: new RecordingLogger(),
      });

      await expect(execute(useCase)).rejects.toThrow(/audit log unavailable/);

      expect(objectStore.temporaryWrites).toHaveLength(1);
      const [tempKey] = objectStore.presignedKeys;
      expect(objectStore.deletedKeys).toContain(tempKey);
    });

    it('does not hide the original audit failure when cleanup itself also fails', async () => {
      const { useCase, logger } = setup({
        auditWriter: new FailingAuditWriter(),
        deleteError: new Error('bucket unavailable during cleanup'),
      });

      await expect(execute(useCase)).rejects.toThrow(/audit log unavailable/);
      expect(logger.errors).toHaveLength(1);
      expect(logger.errors[0]?.message).toMatch(/clean up/i);
    });
  });

  describe('failure before delivery', () => {
    it('produces no url and audits nothing when writing the temporary object fails', async () => {
      const { useCase, objectStore, auditWriter } = setup({
        writeTemporaryObjectError: new Error('store unavailable'),
      });

      await expect(execute(useCase)).rejects.toThrow('store unavailable');

      expect(objectStore.presignedKeys).toHaveLength(0);
      expect(auditWriter.entries).toHaveLength(0);
    });

    it('produces no url when decryption fails — no temporary object is ever created', async () => {
      const { useCase, objectStore, auditWriter } = setup({
        ciphertext: CIPHERTEXT.subarray(0, 10),
      });

      await expect(execute(useCase)).rejects.toThrow();

      expect(objectStore.temporaryWrites).toHaveLength(0);
      expect(objectStore.presignedKeys).toHaveLength(0);
      expect(auditWriter.entries).toHaveLength(0);
    });
  });
});
