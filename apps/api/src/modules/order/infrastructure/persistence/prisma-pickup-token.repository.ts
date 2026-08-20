import type { PrismaClient } from '@prisma/client';
import type { TransactionScope } from '@leen-mart/domain-kit';
import { toUserId, toVendorId, type UserId } from '../../../identity/index.js';
import {
  PickupToken,
  type PickupTokenStatusName,
} from '../../domain/entities/pickup-token.entity.js';
import type { PickupTokenRepository } from '../../domain/repositories/pickup-token.repository.js';
import {
  toPickupTokenId,
  type PickupTokenId,
} from '../../domain/value-objects/pickup-token-id.value-object.js';
import { toSubOrderId } from '../../domain/value-objects/sub-order-id.value-object.js';

interface PickupTokenRow {
  readonly id: string;
  readonly subOrderId: string;
  readonly vendorId: string;
  readonly status: string;
  readonly tokenHash: string;
  readonly nonce: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly redeemedAt: Date | null;
  readonly redeemedByUserId: string | null;
  readonly version: number;
  readonly manualCodeHash: string | null;
  readonly manualCodeAttempts: number;
  readonly createdAt: Date;
}

const toDomain = (row: PickupTokenRow): PickupToken =>
  PickupToken.reconstitute({
    id: toPickupTokenId(row.id),
    subOrderId: toSubOrderId(row.subOrderId),
    vendorId: toVendorId(row.vendorId),
    status: row.status as PickupTokenStatusName,
    tokenHash: row.tokenHash,
    nonce: row.nonce,
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
    redeemedAt: row.redeemedAt,
    redeemedByUserId: row.redeemedByUserId ? toUserId(row.redeemedByUserId) : null,
    version: row.version,
    manualCodeHash: row.manualCodeHash,
    manualCodeAttempts: row.manualCodeAttempts,
    createdAt: row.createdAt,
  });

/**
 * `pickup_tokens` (S4-QR, SDD §13.1). Constructed on two different
 * credentials depending on caller — see this port's own doc comment. Maps
 * rows to `PickupToken` at the boundary; Prisma types never escape this file
 * (SDD 3.4).
 */
export class PrismaPickupTokenRepository implements PickupTokenRepository {
  constructor(private readonly prisma: PrismaClient) {}

  withTransaction(scope: TransactionScope): PickupTokenRepository {
    return new PrismaPickupTokenRepository(scope as unknown as PrismaClient);
  }

  async findBySubOrderId(subOrderId: string): Promise<PickupToken | null> {
    const row = await this.prisma.pickupToken.findUnique({ where: { subOrderId } });
    return row ? toDomain(row) : null;
  }

  async create(token: PickupToken): Promise<void> {
    await this.prisma.pickupToken.create({
      data: {
        id: token.id,
        subOrderId: token.subOrderId,
        vendorId: token.vendorId,
        status: token.status,
        tokenHash: token.tokenHash,
        nonce: token.nonce,
        issuedAt: token.issuedAt,
        expiresAt: token.expiresAt,
        manualCodeHash: token.manualCodeHash,
        manualCodeAttempts: token.manualCodeAttempts,
        createdAt: token.createdAt,
      },
    });
  }

  /** Overwrites the hash/nonce/validity window (and the manual fallback code alongside it, S4-QR-FALLBACK) in place — never touches `status`, matching the port's own guarantee. */
  async rotate(token: PickupToken): Promise<void> {
    await this.prisma.pickupToken.update({
      where: { id: token.id },
      data: {
        tokenHash: token.tokenHash,
        nonce: token.nonce,
        issuedAt: token.issuedAt,
        expiresAt: token.expiresAt,
        manualCodeHash: token.manualCodeHash,
        manualCodeAttempts: token.manualCodeAttempts,
      },
    });
  }

  /** Plain update, not a compare-and-set — a wrong manual-code guess never touches `status` (S4-QR-FALLBACK, port's own doc comment). */
  async recordManualCodeAttempt(id: PickupTokenId, attempts: number): Promise<void> {
    await this.prisma.pickupToken.update({
      where: { id },
      data: { manualCodeAttempts: attempts },
    });
  }

  /**
   * The atomic compare-and-set (SDD 13.1): `WHERE status = 'ISSUED'` in the
   * same statement as the write, never a prior read — the same
   * `Inventory.setIfVersionMatches`/`SubOrder` idiom every conditional write
   * in this codebase already uses. `false` means the row was already
   * `REDEEMED` by the time this statement ran, whether by a genuine earlier
   * scan or a concurrent request racing this exact one.
   */
  async redeemIfIssued(
    id: PickupTokenId,
    redeemedAt: Date,
    redeemedByUserId: UserId,
  ): Promise<boolean> {
    const result = await this.prisma.pickupToken.updateMany({
      where: { id, status: 'ISSUED' },
      data: {
        status: 'REDEEMED',
        redeemedAt,
        redeemedByUserId,
        version: { increment: 1 },
      },
    });
    return result.count === 1;
  }
}
