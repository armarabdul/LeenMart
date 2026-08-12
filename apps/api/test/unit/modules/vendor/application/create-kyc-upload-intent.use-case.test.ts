import { describe, expect, it, vi } from 'vitest';
import { FixedClock, UuidV7Generator, ValidationError } from '@leen-mart/domain-kit';
import { CreateKycUploadIntentUseCase } from '../../../../../src/modules/vendor/application/use-cases/create-kyc-upload-intent.use-case.js';
import type {
  DataKeyCipher,
  EncryptionContext,
  GeneratedDataKey,
} from '../../../../../src/modules/vendor/application/ports/data-key-cipher.port.js';
import type {
  ObjectStore,
  PresignPutInput,
  PresignedDownload,
  PresignedUpload,
  StoredObject,
  TemporaryObject,
} from '../../../../../src/modules/vendor/application/ports/object-store.port.js';
import type { VendorRepository } from '../../../../../src/modules/vendor/domain/repositories/vendor.repository.js';
import { VendorProfile } from '../../../../../src/modules/vendor/domain/entities/vendor-profile.entity.js';
import { VendorStatus } from '../../../../../src/modules/vendor/domain/value-objects/vendor-status.value-object.js';
import { InvalidVendorStatusTransitionError } from '../../../../../src/modules/vendor/domain/errors/vendor-errors.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toVendorId } from '../../../../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';
import { toSessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import type { Principal } from '../../../../../src/modules/identity/application/ports/principal.js';
import { nullLogger } from '../../identity/application/fakes.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const EXPIRES = new Date('2026-01-01T00:05:00.000Z');
const vendorId = toVendorId('00000000-0000-7000-8000-0000000000e1');
const userId = toUserId('00000000-0000-7000-8000-0000000000e2');

const principal: Principal = {
  userId,
  sessionId: toSessionId('00000000-0000-7000-8000-0000000000e3'),
  role: 'VENDOR_OWNER',
};

const REQUESTED = [
  { type: 'PAN', contentType: 'application/pdf', sizeBytes: 1024 },
  { type: 'GSTIN', contentType: 'image/png', sizeBytes: 2048 },
  { type: 'BANK_ACCOUNT_PROOF', contentType: 'image/jpeg', sizeBytes: 4096 },
];

/** Records every key it is asked to mint, so the tests can assert on context binding. */
class RecordingDataKeyCipher implements DataKeyCipher {
  readonly generated: { context: EncryptionContext | undefined; plaintext: Buffer }[] = [];
  readonly shredded: Buffer[] = [];
  private seq = 0;

  generateDataKey(context?: EncryptionContext): Promise<GeneratedDataKey> {
    this.seq += 1;
    const plaintext = Buffer.alloc(32, this.seq);
    const generated = { plaintext, wrapped: Buffer.from(`wrapped-${String(this.seq)}`) };
    this.generated.push({ context, plaintext });
    return Promise.resolve(generated);
  }

  unwrap(): Promise<Buffer> {
    throw new Error('not used by this use case');
  }

  shred(plaintext: Buffer): void {
    this.shredded.push(plaintext);
    plaintext.fill(0);
  }
}

class RecordingObjectStore implements ObjectStore {
  readonly presigned: PresignPutInput[] = [];
  constructor(private readonly onPresign?: (input: PresignPutInput) => void) {}

  presignPut(input: PresignPutInput): Promise<PresignedUpload> {
    this.onPresign?.(input);
    this.presigned.push(input);
    return Promise.resolve({
      url: `https://store.example/${input.key}`,
      expiresAt: EXPIRES,
      contentType: input.contentType,
      contentLength: input.contentLength,
    });
  }

  presignGet(): Promise<PresignedDownload> {
    throw new Error('not used by this use case');
  }

  head(): Promise<StoredObject | null> {
    throw new Error('not used by this use case');
  }

  getObject(): Promise<Buffer | null> {
    throw new Error('not used by this use case');
  }

  writeTemporaryObject(): Promise<TemporaryObject> {
    throw new Error('not used by this use case');
  }

  delete(): Promise<void> {
    throw new Error('not used by this use case');
  }
}

const vendorIn = (status: VendorStatus): VendorProfile =>
  VendorProfile.reconstitute({ id: vendorId, userId, status, createdAt: NOW, updatedAt: NOW });

const setup = (
  options: { vendor?: VendorProfile | null; onPresign?: (input: PresignPutInput) => void } = {},
): {
  useCase: CreateKycUploadIntentUseCase;
  cipher: RecordingDataKeyCipher;
  store: RecordingObjectStore;
  vendorRepository: VendorRepository;
} => {
  const vendor = options.vendor === undefined ? vendorIn(VendorStatus.REGISTERED) : options.vendor;
  const cipher = new RecordingDataKeyCipher();
  const store = new RecordingObjectStore(options.onPresign);

  const vendorRepository = {
    create: vi.fn(),
    update: vi.fn(),
    findById: vi.fn(),
    findByUserId: vi.fn().mockResolvedValue(vendor),
  } as unknown as VendorRepository;

  return {
    useCase: new CreateKycUploadIntentUseCase({
      vendorRepository,
      objectStore: store,
      dataKeyCipher: cipher,
      idGenerator: new UuidV7Generator(),
      clock: new FixedClock(NOW),
      logger: nullLogger,
    }),
    cipher,
    store,
    vendorRepository,
  };
};

describe('CreateKycUploadIntentUseCase', () => {
  describe('submission identity', () => {
    it('mints one server-generated kycId shared by all three intents', async () => {
      const { useCase } = setup();

      const result = await useCase.execute({ principal, documents: REQUESTED });

      expect(result.documents).toHaveLength(3);
      const kycIds = result.documents.map((document) => document.objectKey.split('/')[2]);
      expect(new Set(kycIds).size).toBe(1);
      expect(kycIds[0]).toBe(result.kycId);
    });

    it('mints a different kycId on every call', async () => {
      const { useCase } = setup();

      const first = await useCase.execute({ principal, documents: REQUESTED });
      const second = await useCase.execute({ principal, documents: REQUESTED });

      expect(second.kycId).not.toBe(first.kycId);
    });
  });

  describe('object keys', () => {
    it('derives every key from the server-held vendorId, kycId and type', async () => {
      const { useCase } = setup();

      const result = await useCase.execute({ principal, documents: REQUESTED });

      const byType = new Map(result.documents.map((document) => [document.type, document]));
      for (const type of ['PAN', 'GSTIN', 'BANK_ACCOUNT_PROOF']) {
        expect(byType.get(type)?.objectKey).toBe(`vendor/${vendorId}/${result.kycId}/${type}.enc`);
      }
    });

    it('presigns exactly the derived keys, with the declared type and length', async () => {
      const { useCase, store } = setup();

      const result = await useCase.execute({ principal, documents: REQUESTED });

      expect(store.presigned).toHaveLength(3);
      expect(store.presigned.map((input) => input.key).sort()).toEqual(
        ['BANK_ACCOUNT_PROOF', 'GSTIN', 'PAN']
          .map((type) => `vendor/${vendorId}/${result.kycId}/${type}.enc`)
          .sort(),
      );
      const pan = store.presigned.find((input) => input.key.endsWith('PAN.enc'));
      expect(pan?.contentType).toBe('application/pdf');
      expect(pan?.contentLength).toBe(1024);
    });
  });

  describe('encryption context (SDD 12.3)', () => {
    it('binds every data key to vendorId, kycId and documentType', async () => {
      const { useCase, cipher } = setup();

      const result = await useCase.execute({ principal, documents: REQUESTED });

      expect(cipher.generated).toHaveLength(3);
      const contexts = cipher.generated.map((entry) => entry.context);
      for (const type of ['PAN', 'GSTIN', 'BANK_ACCOUNT_PROOF']) {
        expect(contexts).toContainEqual({ vendorId, kycId: result.kycId, documentType: type });
      }
    });
  });

  describe('key hygiene', () => {
    it('shreds every plaintext key it mints', async () => {
      const { useCase, cipher } = setup();

      await useCase.execute({ principal, documents: REQUESTED });

      expect(cipher.shredded).toHaveLength(3);
      for (const key of cipher.generated) {
        expect(key.plaintext.every((byte) => byte === 0)).toBe(true);
      }
    });

    it('shreds the key even when presigning fails', async () => {
      // A rejected content type must not leave live key material in memory.
      const { useCase, cipher } = setup({
        onPresign: () => {
          throw new ValidationError('This file type is not accepted.');
        },
      });

      await expect(useCase.execute({ principal, documents: REQUESTED })).rejects.toBeInstanceOf(
        ValidationError,
      );
      expect(cipher.shredded).toHaveLength(1);
      expect(cipher.generated[0]?.plaintext.every((byte) => byte === 0)).toBe(true);
    });

    it('returns the wrapped key base64-encoded, and it is not the plaintext', async () => {
      const { useCase } = setup();

      const result = await useCase.execute({ principal, documents: REQUESTED });

      for (const document of result.documents) {
        expect(Buffer.from(document.wrappedDataKey, 'base64').toString()).toMatch(/^wrapped-\d$/);
        expect(document.dataKey).not.toBe(document.wrappedDataKey);
        expect(Buffer.from(document.dataKey, 'base64')).toHaveLength(32);
      }
    });
  });

  describe('lifecycle guard (SDD 15.1)', () => {
    it.each([
      ['REGISTERED', VendorStatus.REGISTERED],
      ['KYC_REJECTED', VendorStatus.KYC_REJECTED],
    ])('allows a %s vendor to mint intents', async (_label, status) => {
      const { useCase } = setup({ vendor: vendorIn(status) });

      await expect(useCase.execute({ principal, documents: REQUESTED })).resolves.toBeDefined();
    });

    it.each([
      ['KYC_SUBMITTED', VendorStatus.KYC_SUBMITTED],
      ['KYC_UNDER_REVIEW', VendorStatus.KYC_UNDER_REVIEW],
      ['KYC_APPROVED', VendorStatus.KYC_APPROVED],
      ['ACTIVE', VendorStatus.ACTIVE],
      ['SUSPENDED', VendorStatus.SUSPENDED],
      ['TERMINATED', VendorStatus.TERMINATED],
    ])('refuses a %s vendor, minting nothing', async (_label, status) => {
      const { useCase, cipher, store } = setup({ vendor: vendorIn(status) });

      await expect(useCase.execute({ principal, documents: REQUESTED })).rejects.toBeInstanceOf(
        InvalidVendorStatusTransitionError,
      );
      // No upload capability and no key material for a vendor who cannot submit.
      expect(cipher.generated).toHaveLength(0);
      expect(store.presigned).toHaveLength(0);
    });

    it('refuses an account with no vendor profile', async () => {
      const { useCase, store } = setup({ vendor: null });

      await expect(useCase.execute({ principal, documents: REQUESTED })).rejects.toThrow();
      expect(store.presigned).toHaveLength(0);
    });
  });

  describe('requested document set', () => {
    it('refuses a missing required type', async () => {
      const { useCase } = setup();

      await expect(
        useCase.execute({ principal, documents: REQUESTED.slice(0, 2) }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('refuses a duplicated type', async () => {
      const { useCase } = setup();

      await expect(
        useCase.execute({
          principal,
          documents: [REQUESTED[0]!, REQUESTED[0]!, REQUESTED[1]!],
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('refuses an unknown type', async () => {
      const { useCase } = setup();

      await expect(
        useCase.execute({
          principal,
          documents: [
            { type: 'PASSPORT', contentType: 'application/pdf', sizeBytes: 10 },
            REQUESTED[1]!,
            REQUESTED[2]!,
          ],
        }),
      ).rejects.toThrow();
    });
  });

  describe('persistence', () => {
    it('writes nothing — KYC-4a mints capability only', async () => {
      const { useCase, vendorRepository } = setup();

      await useCase.execute({ principal, documents: REQUESTED });

      expect(vendorRepository.create).not.toHaveBeenCalled();
      expect(vendorRepository.update).not.toHaveBeenCalled();
    });

    it('reports the earliest URL expiry as the set deadline', async () => {
      const { useCase } = setup();

      const result = await useCase.execute({ principal, documents: REQUESTED });

      expect(result.expiresAt).toEqual(EXPIRES);
    });
  });
});
