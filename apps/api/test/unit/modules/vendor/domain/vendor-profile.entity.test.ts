import { describe, expect, it } from 'vitest';
import { VendorProfile } from '../../../../../src/modules/vendor/domain/entities/vendor-profile.entity.js';
import {
  VendorStatus,
  type VendorStatusName,
} from '../../../../../src/modules/vendor/domain/value-objects/vendor-status.value-object.js';
import { InvalidVendorStatusTransitionError } from '../../../../../src/modules/vendor/domain/errors/vendor-errors.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toVendorId } from '../../../../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';

const vendorId = toVendorId('00000000-0000-7000-8000-0000000000a1');
const userId = toUserId('00000000-0000-7000-8000-0000000000a2');
const now = new Date('2026-01-01T00:00:00.000Z');
const later = new Date('2026-01-02T00:00:00.000Z');

const inState = (status: VendorStatus): VendorProfile =>
  VendorProfile.reconstitute({ id: vendorId, userId, status, createdAt: now, updatedAt: now });

/** Every transition method, so the illegal-move tests can sweep the whole surface. */
const TRANSITIONS = {
  submitKyc: (vendor: VendorProfile) => vendor.submitKyc(later),
  startKycReview: (vendor: VendorProfile) => vendor.startKycReview(later),
  approveKyc: (vendor: VendorProfile) => vendor.approveKyc(later),
  rejectKyc: (vendor: VendorProfile) => vendor.rejectKyc(later),
  activate: (vendor: VendorProfile) => vendor.activate(later),
  suspend: (vendor: VendorProfile) => vendor.suspend(later),
  reinstate: (vendor: VendorProfile) => vendor.reinstate(later),
} as const;

type TransitionName = keyof typeof TRANSITIONS;

/** The seven edges SDD 15.1 draws. Anything not listed here must be refused. */
const LEGAL: readonly (readonly [TransitionName, VendorStatusName, VendorStatusName])[] = [
  ['submitKyc', 'REGISTERED', 'KYC_SUBMITTED'],
  ['submitKyc', 'KYC_REJECTED', 'KYC_SUBMITTED'],
  ['startKycReview', 'KYC_SUBMITTED', 'KYC_UNDER_REVIEW'],
  ['approveKyc', 'KYC_UNDER_REVIEW', 'KYC_APPROVED'],
  ['rejectKyc', 'KYC_UNDER_REVIEW', 'KYC_REJECTED'],
  ['activate', 'KYC_APPROVED', 'ACTIVE'],
  ['suspend', 'ACTIVE', 'SUSPENDED'],
  ['reinstate', 'SUSPENDED', 'ACTIVE'],
];

const ALL_STATES: readonly VendorStatusName[] = [
  'REGISTERED',
  'KYC_SUBMITTED',
  'KYC_UNDER_REVIEW',
  'KYC_REJECTED',
  'KYC_APPROVED',
  'ACTIVE',
  'SUSPENDED',
  'TERMINATED',
];

const isLegal = (name: TransitionName, from: VendorStatusName): boolean =>
  LEGAL.some(([transition, source]) => transition === name && source === from);

describe('VendorProfile', () => {
  describe('registration', () => {
    it('registers a new vendor in the REGISTERED state (SDD 15.1 lifecycle entry)', () => {
      const vendor = VendorProfile.register({ id: vendorId, userId, now });

      expect(vendor.status).toBe(VendorStatus.REGISTERED);
      expect(vendor.id).toBe(vendorId);
      expect(vendor.userId).toBe(userId);
    });

    it('stamps both timestamps at registration', () => {
      const vendor = VendorProfile.register({ id: vendorId, userId, now });

      expect(vendor.createdAt).toEqual(now);
      expect(vendor.updatedAt).toEqual(now);
    });

    it('never starts anywhere other than REGISTERED, whatever the caller passes', () => {
      const vendor = VendorProfile.register({ id: vendorId, userId, now });

      expect(vendor.status.name).toBe('REGISTERED');
    });

    it('reconstitutes a persisted vendor with its stored status rather than defaulting it', () => {
      const vendor = inState(VendorStatus.KYC_UNDER_REVIEW);

      expect(vendor.status).toBe(VendorStatus.KYC_UNDER_REVIEW);
    });
  });

  describe('legal transitions (SDD 15.1)', () => {
    it.each(LEGAL)('%s moves a vendor from %s to %s', (name, from, to) => {
      const moved = TRANSITIONS[name](inState(VendorStatus.fromName(from)));

      expect(moved.status.name).toBe(to);
    });

    it.each(LEGAL)('%s from %s stamps updatedAt and leaves createdAt alone', (name, from) => {
      const moved = TRANSITIONS[name](inState(VendorStatus.fromName(from)));

      expect(moved.updatedAt).toEqual(later);
      expect(moved.createdAt).toEqual(now);
    });

    it.each(LEGAL)('%s from %s preserves identity', (name, from) => {
      const moved = TRANSITIONS[name](inState(VendorStatus.fromName(from)));

      expect(moved.id).toBe(vendorId);
      expect(moved.userId).toBe(userId);
    });

    it.each(LEGAL)(
      '%s from %s returns a new instance, never mutating the receiver',
      (name, from) => {
        const original = inState(VendorStatus.fromName(from));
        const moved = TRANSITIONS[name](original);

        expect(moved).not.toBe(original);
        expect(original.status.name).toBe(from);
        expect(original.updatedAt).toEqual(now);
      },
    );

    it('walks the full happy path: REGISTERED → ACTIVE', () => {
      const active = VendorProfile.register({ id: vendorId, userId, now })
        .submitKyc(later)
        .startKycReview(later)
        .approveKyc(later)
        .activate(later);

      expect(active.status).toBe(VendorStatus.ACTIVE);
    });

    it('walks the rejection-and-resubmit path back to approval', () => {
      const approved = VendorProfile.register({ id: vendorId, userId, now })
        .submitKyc(later)
        .startKycReview(later)
        .rejectKyc(later)
        .submitKyc(later)
        .startKycReview(later)
        .approveKyc(later);

      expect(approved.status).toBe(VendorStatus.KYC_APPROVED);
    });

    it('walks suspension and reinstatement', () => {
      const reinstated = inState(VendorStatus.ACTIVE).suspend(later).reinstate(later);

      expect(reinstated.status).toBe(VendorStatus.ACTIVE);
    });
  });

  describe('illegal transitions', () => {
    const illegal = ALL_STATES.flatMap((from) =>
      (Object.keys(TRANSITIONS) as TransitionName[])
        .filter((name) => !isLegal(name, from))
        .map((name) => [name, from] as const),
    );

    it.each(illegal)('refuses %s from %s', (name, from) => {
      expect(() => TRANSITIONS[name](inState(VendorStatus.fromName(from)))).toThrow(
        InvalidVendorStatusTransitionError,
      );
    });

    it('names both states so the caller can tell what was refused', () => {
      expect(() => inState(VendorStatus.REGISTERED).activate(later)).toThrow(
        /REGISTERED to ACTIVE/,
      );
    });

    it('reports the refusal as a 422-mapped domain rule, not a validation failure', () => {
      try {
        inState(VendorStatus.REGISTERED).activate(later);
        expect.unreachable('activate() from REGISTERED should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidVendorStatusTransitionError);
        const failure = error as InvalidVendorStatusTransitionError;
        expect(failure.kind).toBe('DOMAIN_RULE');
        expect(failure.code).toBe('VENDOR_INVALID_STATUS_TRANSITION');
        expect(failure.details).toEqual([
          { field: 'status', issue: 'REGISTERED → ACTIVE is not a permitted transition' },
        ]);
      }
    });

    it('cannot skip review: an approval must follow a claimed submission', () => {
      expect(() => inState(VendorStatus.KYC_SUBMITTED).approveKyc(later)).toThrow(
        InvalidVendorStatusTransitionError,
      );
    });

    it('cannot activate a suspended vendor as though they had just cleared KYC', () => {
      expect(() => inState(VendorStatus.SUSPENDED).activate(later)).toThrow(
        InvalidVendorStatusTransitionError,
      );
    });

    it('cannot reinstate a vendor that was never suspended', () => {
      expect(() => inState(VendorStatus.KYC_APPROVED).reinstate(later)).toThrow(
        InvalidVendorStatusTransitionError,
      );
    });
  });

  describe('TERMINATED (SDD 15.1 wind-down, BR-27 unresolved)', () => {
    it('is unreachable: no transition produces it', () => {
      for (const from of ALL_STATES) {
        for (const name of Object.keys(TRANSITIONS) as TransitionName[]) {
          if (!isLegal(name, from)) continue;
          expect(TRANSITIONS[name](inState(VendorStatus.fromName(from))).status.name).not.toBe(
            'TERMINATED',
          );
        }
      }
    });

    it('is inescapable: every transition out of it is refused', () => {
      for (const name of Object.keys(TRANSITIONS) as TransitionName[]) {
        expect(() => TRANSITIONS[name](inState(VendorStatus.TERMINATED))).toThrow(
          InvalidVendorStatusTransitionError,
        );
      }
    });

    it('still reconstitutes, so an already-terminated row remains readable', () => {
      expect(inState(VendorStatus.TERMINATED).status).toBe(VendorStatus.TERMINATED);
    });
  });
});
