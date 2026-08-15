import type { PrismaClient } from '@prisma/client';
import type { TransactionScope } from '@leen-mart/domain-kit';
import type { VendorPlanName } from '../../../vendor/index.js';
import { CommissionRule } from '../../domain/entities/commission-rule.entity.js';
import type { CommissionRuleRepository } from '../../domain/repositories/commission-rule.repository.js';
import { toCommissionRuleId } from '../../domain/value-objects/commission-rule-id.value-object.js';

interface CommissionRuleRow {
  readonly id: string;
  readonly plan: VendorPlanName;
  readonly rateBasisPoints: number;
  readonly effectiveFrom: Date;
  readonly createdAt: Date;
}

const toDomain = (row: CommissionRuleRow): CommissionRule =>
  CommissionRule.reconstitute({
    id: toCommissionRuleId(row.id),
    plan: row.plan,
    rateBasisPoints: row.rateBasisPoints,
    effectiveFrom: row.effectiveFrom,
    createdAt: row.createdAt,
  });

/**
 * Maps rows to `CommissionRule` at the boundary; Prisma types never escape
 * this file (SDD 3.4). Plain `PrismaClient`, no RLS/tenant handling —
 * `commission_rules` is platform-owned configuration, the same posture
 * `categories` already has (not in `TENANT_SCOPED_MODELS`, no RLS). Append-
 * only: no `update`/`softDelete` method exists because none is needed —
 * see `CommissionRule`'s own doc comment.
 */
export class PrismaCommissionRuleRepository implements CommissionRuleRepository {
  constructor(private readonly prisma: PrismaClient) {}

  withTransaction(scope: TransactionScope): CommissionRuleRepository {
    return new PrismaCommissionRuleRepository(scope as unknown as PrismaClient);
  }

  async create(rule: CommissionRule): Promise<void> {
    await this.prisma.commissionRule.create({
      data: {
        id: rule.id,
        plan: rule.plan,
        rateBasisPoints: rule.rateBasisPoints,
        effectiveFrom: rule.effectiveFrom,
        createdAt: rule.createdAt,
      },
    });
  }

  async findEffectiveForPlan(plan: VendorPlanName, asOf: Date): Promise<CommissionRule | null> {
    // The most recent row at or before `asOf` — never a read of "the current
    // rate" alone, so resolving a *past* instant (e.g. re-deriving what an
    // old order was charged) stays correct regardless of what has been
    // configured since.
    const row = await this.prisma.commissionRule.findFirst({
      where: { plan, effectiveFrom: { lte: asOf } },
      orderBy: { effectiveFrom: 'desc' },
    });
    return row ? toDomain(row) : null;
  }
}
