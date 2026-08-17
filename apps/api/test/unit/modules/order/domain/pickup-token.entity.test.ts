import { describe, expect, it } from 'vitest';
import { PickupToken } from '../../../../../src/modules/order/domain/entities/pickup-token.entity.js';
import { PickupTokenAlreadyRedeemedError } from '../../../../../src/modules/order/domain/errors/order-errors.js';
import { toPickupTokenId } from '../../../../../src/modules/order/domain/value-objects/pickup-token-id.value-object.js';
import { toSubOrderId } from '../../../../../src/modules/order/domain/value-objects/sub-order-id.value-object.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toVendorId } from '../../../../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';

const id = toPickupTokenId('00000000-0000-7000-8000-000000000c01');
const subOrderId = toSubOrderId('00000000-0000-7000-8000-000000000c02');
const vendorId = toVendorId('00000000-0000-7000-8000-000000000c03');
const redeemedByUserId = toUserId('00000000-0000-7000-8000-000000000c04');
const issuedAt = new Date('2026-01-01T00:00:00.000Z');
const expiresAt = new Date('2026-01-01T00:01:30.000Z');
const later = new Date('2026-01-01T00:01:00.000Z');

const issue = (): PickupToken =>
  PickupToken.issue({
    id,
    subOrderId,
    vendorId,
    tokenHash: 'a'.repeat(64),
    nonce: 'b'.repeat(32),
    issuedAt,
    expiresAt,
  });

describe('PickupToken', () => {
  describe('issue()', () => {
    it('always starts ISSUED', () => {
      expect(issue().status).toBe('ISSUED');
    });

    it('starts at version 1 with no redemption recorded', () => {
      const token = issue();
      expect(token.version).toBe(1);
      expect(token.redeemedAt).toBeNull();
      expect(token.redeemedByUserId).toBeNull();
    });

    it('stamps createdAt to issuedAt', () => {
      expect(issue().createdAt).toEqual(issuedAt);
    });
  });

  describe('isExpired()', () => {
    it('is false strictly before expiresAt', () => {
      expect(issue().isExpired(later)).toBe(false);
    });

    it('is true at exactly expiresAt', () => {
      expect(issue().isExpired(expiresAt)).toBe(true);
    });

    it('is true after expiresAt', () => {
      expect(issue().isExpired(new Date(expiresAt.getTime() + 1))).toBe(true);
    });
  });

  describe('rotate()', () => {
    it('replaces hash/nonce/validity window while ISSUED', () => {
      const rotated = issue().rotate({
        tokenHash: 'c'.repeat(64),
        nonce: 'd'.repeat(32),
        issuedAt: later,
        expiresAt: new Date(later.getTime() + 90_000),
      });

      expect(rotated.tokenHash).toBe('c'.repeat(64));
      expect(rotated.nonce).toBe('d'.repeat(32));
      expect(rotated.issuedAt).toEqual(later);
      expect(rotated.status).toBe('ISSUED');
    });

    it('never mutates the receiver', () => {
      const original = issue();
      const rotated = original.rotate({
        tokenHash: 'c'.repeat(64),
        nonce: 'd'.repeat(32),
        issuedAt: later,
        expiresAt: new Date(later.getTime() + 90_000),
      });
      expect(rotated).not.toBe(original);
      expect(original.tokenHash).toBe('a'.repeat(64));
    });

    it('refuses to rotate an already-REDEEMED token', () => {
      const redeemed = issue().redeem({ redeemedAt: later, redeemedByUserId });
      expect(() =>
        redeemed.rotate({
          tokenHash: 'c'.repeat(64),
          nonce: 'd'.repeat(32),
          issuedAt: later,
          expiresAt: new Date(later.getTime() + 90_000),
        }),
      ).toThrow(PickupTokenAlreadyRedeemedError);
    });
  });

  describe('redeem()', () => {
    it('moves ISSUED -> REDEEMED and records who/when', () => {
      const redeemed = issue().redeem({ redeemedAt: later, redeemedByUserId });

      expect(redeemed.status).toBe('REDEEMED');
      expect(redeemed.redeemedAt).toEqual(later);
      expect(redeemed.redeemedByUserId).toBe(redeemedByUserId);
    });

    it('never mutates the receiver', () => {
      const original = issue();
      const redeemed = original.redeem({ redeemedAt: later, redeemedByUserId });
      expect(redeemed).not.toBe(original);
      expect(original.status).toBe('ISSUED');
    });

    it('refuses to redeem an already-REDEEMED token — the domain-level half of the single-use guarantee', () => {
      const redeemed = issue().redeem({ redeemedAt: later, redeemedByUserId });
      expect(() => redeemed.redeem({ redeemedAt: later, redeemedByUserId })).toThrow(
        PickupTokenAlreadyRedeemedError,
      );
    });

    it('reports the refusal as a 409-mapped conflict', () => {
      const redeemed = issue().redeem({ redeemedAt: later, redeemedByUserId });
      try {
        redeemed.redeem({ redeemedAt: later, redeemedByUserId });
        expect.unreachable('redeem() on an already-REDEEMED token should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(PickupTokenAlreadyRedeemedError);
        expect((error as PickupTokenAlreadyRedeemedError).kind).toBe('CONFLICT');
        expect((error as PickupTokenAlreadyRedeemedError).code).toBe(
          'PICKUP_TOKEN_ALREADY_REDEEMED',
        );
      }
    });
  });

  describe('reconstitute()', () => {
    it('carries whatever state the repository read, including a prior redemption', () => {
      const token = PickupToken.reconstitute({
        id,
        subOrderId,
        vendorId,
        status: 'REDEEMED',
        tokenHash: 'a'.repeat(64),
        nonce: 'b'.repeat(32),
        issuedAt,
        expiresAt,
        redeemedAt: later,
        redeemedByUserId,
        version: 2,
        createdAt: issuedAt,
      });

      expect(token.status).toBe('REDEEMED');
      expect(token.version).toBe(2);
      expect(token.redeemedByUserId).toBe(redeemedByUserId);
    });
  });
});
