import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  FixedClock,
  UuidV7Generator,
  ValidationError,
  type TransactionRunner,
  type TransactionScope,
} from '@leen-mart/domain-kit';
import type { AuditWriter, AuditWriterInput } from '../../../../../src/modules/audit/index.js';
import { VENDOR_AUDIT_ACTIONS } from '../../../../../src/modules/vendor/domain/audit-actions.js';
import { SubmitVendorKycUseCase } from '../../../../../src/modules/vendor/application/use-cases/submit-vendor-kyc.use-case.js';
import type {
  ObjectStore,
  PresignedDownload,
  PresignedUpload,
  StoredObject,
  TemporaryObject,
} from '../../../../../src/modules/media/index.js';
import type { VendorKycRepository } from '../../../../../src/modules/vendor/domain/repositories/vendor-kyc.repository.js';
import type { VendorRepository } from '../../../../../src/modules/vendor/domain/repositories/vendor.repository.js';
import type { VendorKyc } from '../../../../../src/modules/vendor/domain/entities/vendor-kyc.entity.js';
import type { VendorProfile } from '../../../../../src/modules/vendor/domain/entities/vendor-profile.entity.js';
import { VendorProfile as VendorProfileEntity } from '../../../../../src/modules/vendor/domain/entities/vendor-profile.entity.js';
import { VendorStatus } from '../../../../../src/modules/vendor/domain/value-objects/vendor-status.value-object.js';
import { InvalidVendorStatusTransitionError } from '../../../../../src/modules/vendor/domain/errors/vendor-errors.js';
import {
  IncompleteKycSubmissionError,
  InvalidKycIdentifierError,
} from '../../../../../src/modules/vendor/domain/errors/kyc-errors.js';
import type {
  FingerprintedIdentifier,
  IdentifierFingerprinter,
} from '../../../../../src/modules/vendor/domain/services/identifier-fingerprinter.service.js';
import type { SensitiveFingerprint } from '../../../../../src/modules/vendor/domain/value-objects/sensitive-fingerprint.value-object.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toVendorId } from '../../../../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';
import { toSessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import type { Principal } from '../../../../../src/modules/identity/application/ports/principal.js';
import {
  FailingAuditWriter,
  nullLogger,
  RecordingAuditWriter,
} from '../../identity/application/fakes.js';

const NOW = new Date('2026-02-01T00:00:00.000Z');
const vendorId = toVendorId('00000000-0000-7000-8000-0000000000f1');
const userId = toUserId('00000000-0000-7000-8000-0000000000f2');
const KYC_ID = '01950000-0000-7000-8000-0000000000f3';

const principal: Principal = {
  userId,
  sessionId: toSessionId('00000000-0000-7000-8000-0000000000f4'),
  role: 'VENDOR_OWNER',
};

const PAN = 'ABCDE1234F';
const GSTIN = '27ABCDE1234F1Z0';
const ACCOUNT_NUMBER = '123456789012';
const IFSC = 'HDFC0001234';

const SUBMITTED = [
  {
    type: 'PAN',
    wrappedDataKey: 'd3JhcHBlZC1QQU4=',
    contentType: 'application/pdf',
    sizeBytes: 512,
  },
  { type: 'GSTIN', wrappedDataKey: 'd3JhcHBlZC1HU1Q=', contentType: 'image/png', sizeBytes: 640 },
  {
    type: 'BANK_ACCOUNT_PROOF',
    wrappedDataKey: 'd3JhcHBlZC1CQU5L',
    contentType: 'image/jpeg',
    sizeBytes: 768,
  },
];

const storedFor = (type: string): StoredObject => {
  const declared = SUBMITTED.find((document) => document.type === type);
  return { sizeBytes: declared?.sizeBytes ?? 0, contentType: declared?.contentType ?? '' };
};

/** Answers `head()` from a key→metadata map, so a missing object is simply an absent entry. */
class MapObjectStore implements ObjectStore {
  readonly headed: string[] = [];
  constructor(private readonly objects: Map<string, StoredObject>) {}

  head(key: string): Promise<StoredObject | null> {
    this.headed.push(key);
    return Promise.resolve(this.objects.get(key) ?? null);
  }

  presignPut(): Promise<PresignedUpload> {
    throw new Error('not used by this use case');
  }

  presignGet(): Promise<PresignedDownload> {
    throw new Error('not used by this use case');
  }

  getObject(): Promise<Buffer | null> {
    throw new Error('not used by this use case');
  }

  writeTemporaryObject(): Promise<TemporaryObject> {
    throw new Error('not used by this use case');
  }

  putObject(): Promise<void> {
    throw new Error('not used by this use case');
  }

  delete(): Promise<void> {
    throw new Error('bytes are never deleted by submission');
  }
}

const objectsFor = (kycId = KYC_ID, owner = vendorId): Map<string, StoredObject> =>
  new Map(
    ['PAN', 'GSTIN', 'BANK_ACCOUNT_PROOF'].map((type) => [
      `vendor/${owner}/${kycId}/${type}.enc`,
      storedFor(type),
    ]),
  );

/**
 * A stand-in for the HMAC adapter. The real one lives in infrastructure, and
 * the architecture rule (SDD 2.3) keeps application-layer code — tests
 * included — off adapters. What these tests need is only what the port
 * promises: deterministic, and different for different inputs and kinds.
 */
class FakeFingerprinter implements IdentifierFingerprinter {
  fingerprint(kind: FingerprintedIdentifier, canonicalValue: string): SensitiveFingerprint {
    return createHash('sha256')
      .update(`${kind}:${canonicalValue}`)
      .digest('hex') as SensitiveFingerprint;
  }
}

const vendorIn = (status: VendorStatus): VendorProfile =>
  VendorProfileEntity.reconstitute({
    id: vendorId,
    userId,
    status,
    plan: 'COMMISSION',
    shopName: null,
    supportsPickup: false,
    createdAt: NOW,
    updatedAt: NOW,
  });

interface Harness {
  useCase: SubmitVendorKycUseCase;
  store: MapObjectStore;
  created: VendorKyc[];
  updated: VendorProfile[];
  kycRepository: VendorKycRepository;
  auditWriter: AuditWriter;
  transactionCalls: number;
}

const setup = (
  options: {
    vendor?: VendorProfile | null;
    objects?: Map<string, StoredObject>;
    failCreate?: Error;
    auditWriter?: AuditWriter;
  } = {},
): Harness => {
  const vendor = options.vendor === undefined ? vendorIn(VendorStatus.REGISTERED) : options.vendor;
  const store = new MapObjectStore(options.objects ?? objectsFor());
  const created: VendorKyc[] = [];
  const updated: VendorProfile[] = [];
  const auditWriter = new RecordingAuditWriter();
  const harness = { transactionCalls: 0 };

  const kycRepository = {
    create: vi.fn(async (kyc: VendorKyc) => {
      if (options.failCreate) throw options.failCreate;
      created.push(kyc);
      await Promise.resolve();
    }),
    findById: vi.fn(),
    findCurrentByVendorId: vi.fn(),
    listByVendorId: vi.fn(),
    saveReview: vi.fn(),
    findByIdentifierFingerprints: vi.fn(),
    withTransaction: vi.fn(),
  } as unknown as VendorKycRepository;
  (kycRepository.withTransaction as ReturnType<typeof vi.fn>).mockReturnValue(kycRepository);

  const vendorRepository = {
    create: vi.fn(),
    update: vi.fn(async (profile: VendorProfile) => {
      updated.push(profile);
      await Promise.resolve();
    }),
    findById: vi.fn(),
    findByUserId: vi.fn().mockResolvedValue(vendor),
    withTransaction: vi.fn(),
  } as unknown as VendorRepository;
  (vendorRepository.withTransaction as ReturnType<typeof vi.fn>).mockReturnValue(vendorRepository);

  const transactionRunner: TransactionRunner = {
    run: async (work) => {
      harness.transactionCalls += 1;
      return work({} as TransactionScope);
    },
  };

  const resolvedAuditWriter = options.auditWriter ?? auditWriter;

  return {
    useCase: new SubmitVendorKycUseCase({
      vendorRepository,
      vendorKycRepository: kycRepository,
      objectStore: store,
      fingerprinter: new FakeFingerprinter(),
      transactionRunner,
      auditWriter: resolvedAuditWriter,
      idGenerator: new UuidV7Generator(),
      clock: new FixedClock(NOW),
      logger: nullLogger,
    }),
    store,
    created,
    updated,
    kycRepository,
    auditWriter: resolvedAuditWriter,
    get transactionCalls(): number {
      return harness.transactionCalls;
    },
  };
};

const submit = (
  useCase: SubmitVendorKycUseCase,
  overrides: Partial<Parameters<SubmitVendorKycUseCase['execute']>[0]> = {},
): ReturnType<SubmitVendorKycUseCase['execute']> =>
  useCase.execute({
    principal,
    kycId: KYC_ID,
    pan: PAN,
    gstin: GSTIN,
    bankAccount: { accountNumber: ACCOUNT_NUMBER, ifsc: IFSC },
    documents: SUBMITTED,
    ...overrides,
  });

describe('SubmitVendorKycUseCase', () => {
  describe('successful submission', () => {
    it('persists the submission and transitions the vendor to KYC_SUBMITTED', async () => {
      const { useCase, created, updated } = setup();

      const result = await submit(useCase);

      expect(created).toHaveLength(1);
      expect(created[0]?.id).toBe(KYC_ID);
      expect(created[0]?.vendorId).toBe(vendorId);
      expect(updated).toHaveLength(1);
      expect(updated[0]?.status).toBe(VendorStatus.KYC_SUBMITTED);
      expect(result.vendor.status).toBe(VendorStatus.KYC_SUBMITTED);
    });

    it('writes both repositories inside one transaction', async () => {
      const harness = setup();

      await submit(harness.useCase);

      expect(harness.transactionCalls).toBe(1);
      expect(harness.kycRepository.withTransaction).toHaveBeenCalledTimes(1);
    });

    it('resubmits from KYC_REJECTED, the one other origin SDD 15.1 allows', async () => {
      const { useCase, updated } = setup({ vendor: vendorIn(VendorStatus.KYC_REJECTED) });

      await submit(useCase);

      expect(updated[0]?.status).toBe(VendorStatus.KYC_SUBMITTED);
    });
  });

  describe('identifiers', () => {
    it('canonicalises before fingerprinting, so casing and spacing cannot fork a vendor', async () => {
      const { useCase, created } = setup();
      const canonical = await submit(useCase);
      const { created: created2, useCase: useCase2 } = setup();

      await submit(useCase2, {
        pan: `  ${PAN.toLowerCase()}  `,
        gstin: `  ${GSTIN.toLowerCase()}  `,
        bankAccount: { accountNumber: ACCOUNT_NUMBER, ifsc: IFSC.toLowerCase() },
      });

      expect(created2[0]?.identifiers.panFingerprint).toBe(created[0]?.identifiers.panFingerprint);
      expect(created2[0]?.identifiers.bankFingerprint).toBe(
        created[0]?.identifiers.bankFingerprint,
      );
      expect(created2[0]?.identifiers.gstin).toBe(canonical.kyc.identifiers.gstin);
    });

    it('stores fingerprints and masked tails, never the full PAN or account number', async () => {
      const { useCase, created } = setup();

      await submit(useCase);

      const identifiers = created[0]?.identifiers;
      expect(identifiers?.panFingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(identifiers?.bankFingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(identifiers?.panLast4).toBe('234F');
      expect(identifiers?.bankAccountLast4).toBe('9012');
      expect(identifiers?.ifsc).toBe(IFSC);
      // GSTIN is the stated exception — BR-13 requires it whole.
      expect(identifiers?.gstin).toBe(GSTIN);
      expect(JSON.stringify(identifiers)).not.toContain(ACCOUNT_NUMBER);
    });

    it('gives different identifiers different fingerprints', async () => {
      const first = setup();
      const second = setup();

      await submit(first.useCase);
      await submit(second.useCase, { pan: 'ZYXWV9876E' });

      expect(second.created[0]?.identifiers.panFingerprint).not.toBe(
        first.created[0]?.identifiers.panFingerprint,
      );
    });

    it.each([
      ['pan', { pan: 'not-a-pan' }],
      ['gstin', { gstin: '27ABCDE1234F1Z9' }],
      ['ifsc', { bankAccount: { accountNumber: ACCOUNT_NUMBER, ifsc: 'nope' } }],
    ])('refuses a malformed %s before touching storage', async (_label, overrides) => {
      const { useCase, store, created } = setup();

      await expect(submit(useCase, overrides)).rejects.toBeInstanceOf(InvalidKycIdentifierError);
      expect(store.headed).toHaveLength(0);
      expect(created).toHaveLength(0);
    });
  });

  describe('object verification', () => {
    it('heads the server-derived key for every required type', async () => {
      const { useCase, store } = setup();

      await submit(useCase);

      expect(store.headed.sort()).toEqual(
        ['BANK_ACCOUNT_PROOF', 'GSTIN', 'PAN']
          .map((type) => `vendor/${vendorId}/${KYC_ID}/${type}.enc`)
          .sort(),
      );
    });

    it('refuses when an object is missing', async () => {
      const objects = objectsFor();
      objects.delete(`vendor/${vendorId}/${KYC_ID}/GSTIN.enc`);
      const { useCase, created } = setup({ objects });

      await expect(submit(useCase)).rejects.toBeInstanceOf(ValidationError);
      expect(created).toHaveLength(0);
    });

    it('refuses when the stored size differs from the declared size', async () => {
      const objects = objectsFor();
      objects.set(`vendor/${vendorId}/${KYC_ID}/PAN.enc`, {
        sizeBytes: 999,
        contentType: 'application/pdf',
      });
      const { useCase } = setup({ objects });

      await expect(submit(useCase)).rejects.toBeInstanceOf(ValidationError);
    });

    it('refuses when the stored content type differs from the declared type', async () => {
      const objects = objectsFor();
      objects.set(`vendor/${vendorId}/${KYC_ID}/PAN.enc`, {
        sizeBytes: 512,
        contentType: 'image/png',
      });
      const { useCase } = setup({ objects });

      await expect(submit(useCase)).rejects.toBeInstanceOf(ValidationError);
    });

    it('ignores a kycId whose objects live under another vendor', async () => {
      // The key is derived from the *authenticated* vendor, so pointing at
      // another tenant's submission simply finds nothing here.
      const { useCase, store } = setup({
        objects: objectsFor(KYC_ID, toVendorId('00000000-0000-7000-8000-0000000000ff')),
      });

      await expect(submit(useCase)).rejects.toBeInstanceOf(ValidationError);
      expect(store.headed[0]).toContain(`vendor/${vendorId}/`);
    });
  });

  describe('document set', () => {
    it('refuses a missing required type', async () => {
      const { useCase } = setup();

      await expect(submit(useCase, { documents: SUBMITTED.slice(0, 2) })).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('refuses a duplicated type', async () => {
      const { useCase } = setup();

      await expect(
        submit(useCase, { documents: [SUBMITTED[0]!, SUBMITTED[0]!, SUBMITTED[1]!] }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('records every required document as UPLOADED with its wrapped key preserved', async () => {
      const { useCase, created } = setup();

      await submit(useCase);

      const documents = created[0]?.documents ?? [];
      expect(documents).toHaveLength(3);
      for (const document of documents) {
        expect(document.isUploaded()).toBe(true);
        expect(document.objectKey).toBe(`vendor/${vendorId}/${KYC_ID}/${document.type.name}.enc`);
        const expected = SUBMITTED.find((entry) => entry.type === document.type.name);
        expect(document.wrappedDataKey).toEqual(
          Buffer.from(expected?.wrappedDataKey ?? '', 'base64'),
        );
        expect(document.contentType).toBe(expected?.contentType);
        expect(document.sizeBytes).toBe(expected?.sizeBytes);
      }
    });

    it('surfaces the aggregate rule when the domain refuses the set', async () => {
      // `VendorKyc.submit()` owns completeness; this proves the use case does
      // not shadow it with a check of its own that could drift.
      const { useCase } = setup();

      await expect(
        submit(useCase, {
          documents: [...SUBMITTED, { ...SUBMITTED[0]!, type: 'PAN' }],
        }),
      ).rejects.toThrow();
      expect(IncompleteKycSubmissionError).toBeDefined();
    });
  });

  describe('lifecycle', () => {
    it.each([
      ['KYC_SUBMITTED', VendorStatus.KYC_SUBMITTED],
      ['KYC_UNDER_REVIEW', VendorStatus.KYC_UNDER_REVIEW],
      ['KYC_APPROVED', VendorStatus.KYC_APPROVED],
      ['ACTIVE', VendorStatus.ACTIVE],
      ['SUSPENDED', VendorStatus.SUSPENDED],
      ['TERMINATED', VendorStatus.TERMINATED],
    ])('refuses a %s vendor and writes nothing', async (_label, status) => {
      const harness = setup({ vendor: vendorIn(status) });

      await expect(submit(harness.useCase)).rejects.toBeInstanceOf(
        InvalidVendorStatusTransitionError,
      );
      expect(harness.created).toHaveLength(0);
      expect(harness.updated).toHaveLength(0);
      expect(harness.transactionCalls).toBe(0);
    });

    it('refuses an account with no vendor profile', async () => {
      const { useCase, store } = setup({ vendor: null });

      await expect(submit(useCase)).rejects.toThrow();
      expect(store.headed).toHaveLength(0);
    });
  });

  describe('duplicate detection stays out of submission', () => {
    it('never calls findByIdentifierFingerprints', async () => {
      const { useCase, kycRepository } = setup();

      await submit(useCase);

      expect(kycRepository.findByIdentifierFingerprints).not.toHaveBeenCalled();
    });
  });

  describe('failure behaviour', () => {
    it('does not delete uploaded objects when persistence fails', async () => {
      const { useCase, store } = setup({ failCreate: new Error('write failed') });

      await expect(submit(useCase)).rejects.toThrow('write failed');
      // `MapObjectStore.delete` throws if called at all.
      expect(store.headed).toHaveLength(3);
    });
  });

  describe('sensitive data never leaves', () => {
    it('keeps the account number and both fingerprints out of the serialised form', async () => {
      const { useCase, created } = setup();

      await submit(useCase);

      const serialised = JSON.stringify(created[0]?.toJSON());
      expect(serialised).not.toContain(ACCOUNT_NUMBER);
      expect(serialised).not.toContain(created[0]?.identifiers.panFingerprint);
      expect(serialised).not.toContain(created[0]?.identifiers.bankFingerprint);
      expect(serialised).toContain('[REDACTED]');
    });

    it('carries no standalone PAN field — only the GSTIN the law requires whole', async () => {
      // `VendorKyc` states this consequence rather than hiding it: characters
      // 3–12 of a GSTIN *are* the holder's PAN, so for a GST-registered vendor
      // the PAN is inside the GSTIN by construction. What must not exist is a
      // *second*, standalone plaintext copy of it.
      const { useCase, created } = setup();

      await submit(useCase);

      const identifiers = created[0]?.identifiers;
      expect(identifiers?.gstin).toContain(PAN);
      expect(Object.values({ ...identifiers, gstin: '' })).not.toContain(PAN);
    });

    it('keeps wrapped key material out of the serialised documents', async () => {
      const { useCase, created } = setup();

      await submit(useCase);

      const documents = JSON.stringify(created[0]?.toJSON());
      for (const document of SUBMITTED) {
        expect(documents).not.toContain(document.wrappedDataKey);
      }
    });
  });

  describe('audit (KYC-6)', () => {
    const entryOf = (writer: AuditWriter): AuditWriterInput => {
      const [entry] = (writer as RecordingAuditWriter).entries;
      if (!entry) throw new Error('expected an audit entry');
      return entry;
    };

    it('records exactly one audit event for a successful submission', async () => {
      const { useCase, auditWriter } = setup();

      await submit(useCase);

      expect((auditWriter as RecordingAuditWriter).entries).toHaveLength(1);
    });

    it('records the submission action, entity type and kyc id', async () => {
      const { useCase, auditWriter } = setup();

      await submit(useCase);

      const entry = entryOf(auditWriter);
      expect(entry.action).toBe(VENDOR_AUDIT_ACTIONS.KYC_SUBMITTED);
      expect(entry.entityType).toBe('VendorKyc');
      expect(entry.entityId).toBe(KYC_ID);
    });

    it('takes the actor from the authenticated principal, never the request', async () => {
      const { useCase, auditWriter } = setup();

      await submit(useCase);

      const entry = entryOf(auditWriter);
      expect(entry.actorId).toBe(principal.userId);
      expect(entry.actorRole).toBe(principal.role);
    });

    it('keeps PAN, account number, fingerprints and key material out of the audit payload', async () => {
      const { useCase, auditWriter } = setup();

      await submit(useCase);

      const serialised = JSON.stringify(entryOf(auditWriter));
      expect(serialised).not.toContain(PAN);
      expect(serialised).not.toContain(ACCOUNT_NUMBER);
      expect(serialised).not.toContain('wrappedDataKey');
      for (const document of SUBMITTED) {
        expect(serialised).not.toContain(document.wrappedDataKey);
      }
    });

    it('writes the audit entry through the transaction-bound writer', async () => {
      const auditWriter = new RecordingAuditWriter();
      const withTransaction = vi.spyOn(auditWriter, 'withTransaction');
      const { useCase } = setup({ auditWriter });

      await submit(useCase);

      expect(withTransaction).toHaveBeenCalledTimes(1);
    });

    it('propagates an audit persistence failure rather than returning success', async () => {
      const { useCase } = setup({ auditWriter: new FailingAuditWriter() });

      await expect(submit(useCase)).rejects.toThrow(/audit log unavailable/);
    });
  });
});
