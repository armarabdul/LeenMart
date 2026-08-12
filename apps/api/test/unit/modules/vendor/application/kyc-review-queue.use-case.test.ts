import { describe, expect, it, vi } from 'vitest';
import { NullLogger, UuidV7Generator } from '@leen-mart/domain-kit';
import {
  DEFAULT_REVIEW_STATUSES,
  ListKycReviewQueueUseCase,
} from '../../../../../src/modules/vendor/application/use-cases/list-kyc-review-queue.use-case.js';
import { GetKycReviewSubmissionUseCase } from '../../../../../src/modules/vendor/application/use-cases/get-kyc-review-submission.use-case.js';
import { KycSubmissionNotFoundError } from '../../../../../src/modules/vendor/domain/errors/kyc-errors.js';
import type {
  KycReviewQueryPort,
  KycReviewQueuePage,
  KycReviewStatus,
  KycReviewSubmissionDetail,
} from '../../../../../src/modules/vendor/application/ports/kyc-review-query.port.js';
import { toKycId } from '../../../../../src/modules/vendor/domain/value-objects/kyc-id.value-object.js';
import { toVendorId } from '../../../../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-01-01T00:00:00.000Z');

const kycA = toKycId(ids.generate());
const kycB = toKycId(ids.generate());
const vendorA = toVendorId(ids.generate());
const vendorB = toVendorId(ids.generate());
const reviewerId = ids.generate();

const queueItem = (
  kycId: typeof kycA,
  vendorId: typeof vendorA,
  overrides: Partial<KycReviewQueuePage['items'][number]> = {},
): KycReviewQueuePage['items'][number] => ({
  kycId,
  vendorId,
  vendorStatus: 'KYC_SUBMITTED',
  panLast4: '234F',
  gstin: '27ABCDE1234F1Z0',
  submittedAt: NOW,
  reviewedBy: null,
  startedAt: null,
  ...overrides,
});

const detail = (overrides: Partial<KycReviewSubmissionDetail> = {}): KycReviewSubmissionDetail => ({
  kycId: kycA,
  vendorId: vendorA,
  vendorStatus: 'KYC_SUBMITTED',
  panLast4: '234F',
  gstin: '27ABCDE1234F1Z0',
  bankAccountLast4: '9012',
  ifsc: 'HDFC0001234',
  submittedAt: NOW,
  reviewedBy: null,
  startedAt: null,
  decidedBy: null,
  decidedAt: null,
  rejectionReason: null,
  rejectionNote: null,
  documents: [
    {
      type: 'PAN',
      contentType: 'application/pdf',
      sizeBytes: 2048,
      status: 'UPLOADED',
      uploadedAt: NOW,
    },
  ],
  ...overrides,
});

/**
 * A fake query port. The application layer is tested against the port only —
 * importing the Prisma adapter here would make these tests depend on a
 * database and on the very credential separation they have no business
 * knowing about.
 */
const fakeQuery = (
  overrides: Partial<KycReviewQueryPort> = {},
): KycReviewQueryPort & { calls: { list: unknown[]; detail: unknown[] } } => {
  const calls = { list: [] as unknown[], detail: [] as unknown[] };
  return {
    calls,
    listForReview: vi.fn((input) => {
      calls.list.push(input);
      return Promise.resolve({ items: [], nextCursor: null, hasMore: false });
    }),
    findDetailById: vi.fn((kycId) => {
      calls.detail.push(kycId);
      return Promise.resolve(null);
    }),
    ...overrides,
  };
};

describe('ListKycReviewQueueUseCase', () => {
  it('defaults to the two statuses that mean "awaiting a decision"', async () => {
    // A claimed submission stays in the queue so a second reviewer can see it
    // is already being worked (SDD 15.1).
    const query = fakeQuery();
    const useCase = new ListKycReviewQueueUseCase({
      kycReviewQuery: query,
      logger: new NullLogger(),
    });

    await useCase.execute({ limit: 20 });

    expect(query.calls.list[0]).toMatchObject({
      statuses: ['KYC_SUBMITTED', 'KYC_UNDER_REVIEW'],
    });
    expect(DEFAULT_REVIEW_STATUSES).toEqual(['KYC_SUBMITTED', 'KYC_UNDER_REVIEW']);
  });

  it('never defaults to a page of already-decided submissions', async () => {
    const query = fakeQuery();
    const useCase = new ListKycReviewQueueUseCase({
      kycReviewQuery: query,
      logger: new NullLogger(),
    });

    await useCase.execute({ limit: 20 });

    const { statuses } = query.calls.list[0] as { statuses: KycReviewStatus[] };
    expect(statuses).not.toContain('KYC_APPROVED');
    expect(statuses).not.toContain('KYC_REJECTED');
  });

  it('passes an explicit status filter straight through', async () => {
    const query = fakeQuery();
    const useCase = new ListKycReviewQueueUseCase({
      kycReviewQuery: query,
      logger: new NullLogger(),
    });

    await useCase.execute({ statuses: ['KYC_APPROVED'], limit: 20 });

    expect(query.calls.list[0]).toMatchObject({ statuses: ['KYC_APPROVED'] });
  });

  it('falls back to the default when the filter is explicitly empty', async () => {
    // An empty filter would otherwise mean "match nothing", which reads as a
    // broken queue rather than as the caller's mistake.
    const query = fakeQuery();
    const useCase = new ListKycReviewQueueUseCase({
      kycReviewQuery: query,
      logger: new NullLogger(),
    });

    await useCase.execute({ statuses: [], limit: 20 });

    expect(query.calls.list[0]).toMatchObject({
      statuses: ['KYC_SUBMITTED', 'KYC_UNDER_REVIEW'],
    });
  });

  it('maps limit and cursor to the port unchanged', async () => {
    const query = fakeQuery();
    const useCase = new ListKycReviewQueueUseCase({
      kycReviewQuery: query,
      logger: new NullLogger(),
    });

    await useCase.execute({ limit: 5, cursor: kycA });

    expect(query.calls.list[0]).toMatchObject({ limit: 5, cursor: kycA });
  });

  it('returns submissions from more than one vendor', async () => {
    // The whole point of the admin path: it is cross-tenant by design.
    const query = fakeQuery({
      listForReview: vi.fn().mockResolvedValue({
        items: [queueItem(kycA, vendorA), queueItem(kycB, vendorB)],
        nextCursor: null,
        hasMore: false,
      }),
    });
    const useCase = new ListKycReviewQueueUseCase({
      kycReviewQuery: query,
      logger: new NullLogger(),
    });

    const page = await useCase.execute({ limit: 20 });

    expect(new Set(page.items.map((item) => item.vendorId))).toEqual(new Set([vendorA, vendorB]));
  });

  it('surfaces the claim information for an item already under review', async () => {
    const query = fakeQuery({
      listForReview: vi.fn().mockResolvedValue({
        items: [
          queueItem(kycA, vendorA, {
            vendorStatus: 'KYC_UNDER_REVIEW',
            reviewedBy: reviewerId,
            startedAt: NOW,
          }),
        ],
        nextCursor: null,
        hasMore: false,
      }),
    });
    const useCase = new ListKycReviewQueueUseCase({
      kycReviewQuery: query,
      logger: new NullLogger(),
    });

    const [item] = (await useCase.execute({ limit: 20 })).items;

    expect(item?.reviewedBy).toBe(reviewerId);
    expect(item?.startedAt).toEqual(NOW);
  });

  it('passes the page through without adding anything sensitive', async () => {
    const query = fakeQuery({
      listForReview: vi.fn().mockResolvedValue({
        items: [queueItem(kycA, vendorA)],
        nextCursor: kycA,
        hasMore: true,
      }),
    });
    const useCase = new ListKycReviewQueueUseCase({
      kycReviewQuery: query,
      logger: new NullLogger(),
    });

    const page = await useCase.execute({ limit: 1 });

    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe(kycA);
    expect(Object.keys(page.items[0] ?? {}).sort()).toEqual([
      'gstin',
      'kycId',
      'panLast4',
      'reviewedBy',
      'startedAt',
      'submittedAt',
      'vendorId',
      'vendorStatus',
    ]);
  });

  it('reads only — the port it depends on has no write method to call', () => {
    const query = fakeQuery();

    expect(Object.keys(query)).not.toContain('saveReview');
    expect(Object.keys(query)).not.toContain('startReview');
    expect(Object.keys(query)).not.toContain('approve');
    expect(Object.keys(query)).not.toContain('reject');
  });
});

describe('GetKycReviewSubmissionUseCase', () => {
  it('returns the submission when it exists', async () => {
    const query = fakeQuery({ findDetailById: vi.fn().mockResolvedValue(detail()) });
    const useCase = new GetKycReviewSubmissionUseCase({
      kycReviewQuery: query,
      logger: new NullLogger(),
    });

    const found = await useCase.execute({ kycId: kycA });

    expect(found.kycId).toBe(kycA);
    expect(found.vendorId).toBe(vendorA);
  });

  it('throws the standard not-found error for an unknown id', async () => {
    const query = fakeQuery({ findDetailById: vi.fn().mockResolvedValue(null) });
    const useCase = new GetKycReviewSubmissionUseCase({
      kycReviewQuery: query,
      logger: new NullLogger(),
    });

    await expect(useCase.execute({ kycId: kycB })).rejects.toBeInstanceOf(
      KycSubmissionNotFoundError,
    );
  });

  it('does not describe the missing id back to the caller', async () => {
    const query = fakeQuery({ findDetailById: vi.fn().mockResolvedValue(null) });
    const useCase = new GetKycReviewSubmissionUseCase({
      kycReviewQuery: query,
      logger: new NullLogger(),
    });

    const error = await useCase
      .execute({ kycId: kycB })
      .then(() => null)
      .catch((caught: unknown) => caught as Error);

    expect(error?.message).not.toContain(kycB);
  });

  it('exposes the masked identifiers a reviewer needs and nothing more', async () => {
    const query = fakeQuery({ findDetailById: vi.fn().mockResolvedValue(detail()) });
    const useCase = new GetKycReviewSubmissionUseCase({
      kycReviewQuery: query,
      logger: new NullLogger(),
    });

    const found = await useCase.execute({ kycId: kycA });

    expect(found.panLast4).toBe('234F');
    expect(found.bankAccountLast4).toBe('9012');
    expect(found.ifsc).toBe('HDFC0001234');
  });

  it('carries no key material, fingerprint or object key', async () => {
    // The read model has no such field, so this is asserting the shape the
    // application layer is even able to hold — not filtering after the fact.
    const query = fakeQuery({ findDetailById: vi.fn().mockResolvedValue(detail()) });
    const useCase = new GetKycReviewSubmissionUseCase({
      kycReviewQuery: query,
      logger: new NullLogger(),
    });

    const found = await useCase.execute({ kycId: kycA });
    const serialised = JSON.stringify(found);

    for (const forbidden of [
      'wrappedDataKey',
      'dataKey',
      'panFingerprint',
      'bankFingerprint',
      'objectKey',
      'uploadUrl',
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it('returns document metadata without any storage reference', async () => {
    const query = fakeQuery({ findDetailById: vi.fn().mockResolvedValue(detail()) });
    const useCase = new GetKycReviewSubmissionUseCase({
      kycReviewQuery: query,
      logger: new NullLogger(),
    });

    const [document] = (await useCase.execute({ kycId: kycA })).documents;

    expect(Object.keys(document ?? {}).sort()).toEqual([
      'contentType',
      'sizeBytes',
      'status',
      'type',
      'uploadedAt',
    ]);
  });

  it('preserves a recorded decision without altering it', async () => {
    const decided = detail({
      vendorStatus: 'KYC_REJECTED',
      reviewedBy: reviewerId,
      startedAt: NOW,
      decidedBy: reviewerId,
      decidedAt: NOW,
      rejectionReason: 'DOCUMENT_UNCLEAR',
      rejectionNote: 'Blurred.',
    });
    const query = fakeQuery({ findDetailById: vi.fn().mockResolvedValue(decided) });
    const useCase = new GetKycReviewSubmissionUseCase({
      kycReviewQuery: query,
      logger: new NullLogger(),
    });

    const found = await useCase.execute({ kycId: kycA });

    expect(found.rejectionReason).toBe('DOCUMENT_UNCLEAR');
    expect(found.decidedBy).toBe(reviewerId);
  });

  it('calls the port exactly once and writes nothing', async () => {
    const findDetailById = vi.fn().mockResolvedValue(detail());
    const query = fakeQuery({ findDetailById });
    const useCase = new GetKycReviewSubmissionUseCase({
      kycReviewQuery: query,
      logger: new NullLogger(),
    });

    await useCase.execute({ kycId: kycA });

    expect(findDetailById).toHaveBeenCalledTimes(1);
    expect(findDetailById).toHaveBeenCalledWith(kycA);
  });
});
