import type { PrismaClient } from '@prisma/client';
import type { TransactionScope } from '@leen-mart/domain-kit';
import { TaxRate } from '../../domain/entities/tax-rate.entity.js';
import type { TaxRateRepository } from '../../domain/repositories/tax-rate.repository.js';
import { toTaxRateId } from '../../domain/value-objects/tax-rate-id.value-object.js';

interface TaxRateRow {
  readonly id: string;
  readonly hsnCode: string;
  readonly rateBasisPoints: number;
  readonly effectiveFrom: Date;
  readonly createdAt: Date;
}

const toDomain = (row: TaxRateRow): TaxRate =>
  TaxRate.reconstitute({
    id: toTaxRateId(row.id),
    hsnCode: row.hsnCode,
    rateBasisPoints: row.rateBasisPoints,
    effectiveFrom: row.effectiveFrom,
    createdAt: row.createdAt,
  });

/**
 * Maps rows to `TaxRate` at the boundary; Prisma types never escape this
 * file (SDD 3.4). Plain `PrismaClient`, no RLS/tenant handling —
 * `tax_rates` is platform-owned configuration, the same posture
 * `categories` already has. Append-only, same reasoning as
 * `PrismaCommissionRuleRepository`.
 */
export class PrismaTaxRateRepository implements TaxRateRepository {
  constructor(private readonly prisma: PrismaClient) {}

  withTransaction(scope: TransactionScope): TaxRateRepository {
    return new PrismaTaxRateRepository(scope as unknown as PrismaClient);
  }

  async create(rate: TaxRate): Promise<void> {
    await this.prisma.taxRate.create({
      data: {
        id: rate.id,
        hsnCode: rate.hsnCode,
        rateBasisPoints: rate.rateBasisPoints,
        effectiveFrom: rate.effectiveFrom,
        createdAt: rate.createdAt,
      },
    });
  }

  async findEffectiveForHsnCode(hsnCode: string, asOf: Date): Promise<TaxRate | null> {
    const row = await this.prisma.taxRate.findFirst({
      where: { hsnCode, effectiveFrom: { lte: asOf } },
      orderBy: { effectiveFrom: 'desc' },
    });
    return row ? toDomain(row) : null;
  }
}
