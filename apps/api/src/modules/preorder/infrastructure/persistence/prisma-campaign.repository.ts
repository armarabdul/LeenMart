import type { TransactionScope } from '@leen-mart/domain-kit';
import type { Prisma, PrismaClient } from '@prisma/client';
import { toVendorId, type VendorId } from '../../../identity/index.js';
import { toProductVariantId, type ProductVariantId } from '../../../catalogue/index.js';
import { PreorderCampaign } from '../../domain/entities/preorder-campaign.entity.js';
import type {
  CampaignListPage,
  CampaignRepository,
} from '../../domain/repositories/campaign.repository.js';
import {
  toCampaignId,
  type CampaignId,
} from '../../domain/value-objects/campaign-id.value-object.js';
import {
  CampaignStatus,
  type CampaignStatusName,
} from '../../domain/value-objects/campaign-status.value-object.js';
import {
  CampaignFulfilmentMode,
  type CampaignFulfilmentModeName,
} from '../../domain/value-objects/campaign-fulfilment-mode.value-object.js';

type CampaignRow = Prisma.PreorderCampaignGetPayload<Record<string, never>>;

const toDomain = (row: CampaignRow): PreorderCampaign =>
  PreorderCampaign.reconstitute({
    id: toCampaignId(row.id),
    vendorId: toVendorId(row.vendorId),
    variantId: toProductVariantId(row.variantId),
    status: CampaignStatus.fromName(row.status),
    opensAt: row.opensAt,
    orderCutoffAt: row.orderCutoffAt,
    fulfilmentWindowStart: row.fulfilmentWindowStart,
    fulfilmentWindowEnd: row.fulfilmentWindowEnd,
    totalQuantity: row.totalQuantity,
    remainingQuantity: row.remainingQuantity,
    advancePercent: row.advancePercent,
    maxPerCustomer: row.maxPerCustomer,
    fulfilmentMode: CampaignFulfilmentMode.fromName(row.fulfilmentMode),
    firstReservationConfirmedAt: row.firstReservationConfirmedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

interface CampaignRowInput {
  readonly id: CampaignId;
  readonly vendorId: VendorId;
  readonly variantId: ProductVariantId;
  readonly status: CampaignStatusName;
  readonly opensAt: Date;
  readonly orderCutoffAt: Date;
  readonly fulfilmentWindowStart: Date;
  readonly fulfilmentWindowEnd: Date;
  readonly totalQuantity: number;
  readonly remainingQuantity: number;
  readonly advancePercent: number;
  readonly maxPerCustomer: number;
  readonly fulfilmentMode: CampaignFulfilmentModeName;
  readonly firstReservationConfirmedAt: Date | null;
  readonly updatedAt: Date;
}

const toRow = (campaign: PreorderCampaign): CampaignRowInput => ({
  id: campaign.id,
  vendorId: campaign.vendorId,
  variantId: campaign.variantId,
  status: campaign.status.name,
  opensAt: campaign.opensAt,
  orderCutoffAt: campaign.orderCutoffAt,
  fulfilmentWindowStart: campaign.fulfilmentWindowStart,
  fulfilmentWindowEnd: campaign.fulfilmentWindowEnd,
  totalQuantity: campaign.totalQuantity,
  remainingQuantity: campaign.remainingQuantity,
  advancePercent: campaign.advancePercent,
  maxPerCustomer: campaign.maxPerCustomer,
  fulfilmentMode: campaign.fulfilmentMode.name,
  firstReservationConfirmedAt: campaign.firstReservationConfirmedAt,
  updatedAt: campaign.updatedAt,
});

/**
 * Vendor-owned (`preorder_campaigns_vendor_*` RLS on `leenmart_app`) or
 * cross-vendor via `publicPrisma`/`checkoutPrisma`, depending which client
 * this instance is constructed with — the same convention every other
 * dual-audience repository in this codebase already follows (e.g.
 * `PrismaProductRepository`).
 */
export class PrismaCampaignRepository implements CampaignRepository {
  constructor(private readonly prisma: PrismaClient) {}

  withTransaction(scope: TransactionScope): CampaignRepository {
    return new PrismaCampaignRepository(scope as unknown as PrismaClient);
  }

  async create(campaign: PreorderCampaign): Promise<void> {
    await this.prisma.preorderCampaign.create({
      data: { ...toRow(campaign), createdAt: campaign.createdAt },
    });
  }

  async findById(id: CampaignId): Promise<PreorderCampaign | null> {
    const row = await this.prisma.preorderCampaign.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByIdAndVendorId(id: CampaignId, vendorId: VendorId): Promise<PreorderCampaign | null> {
    const row = await this.prisma.preorderCampaign.findFirst({ where: { id, vendorId } });
    return row ? toDomain(row) : null;
  }

  async findPublicById(id: CampaignId): Promise<PreorderCampaign | null> {
    const row = await this.prisma.preorderCampaign.findFirst({
      where: { id, status: { not: 'DRAFT' } },
    });
    return row ? toDomain(row) : null;
  }

  async listByVendorId(input: {
    vendorId: VendorId;
    limit: number;
    cursor?: string | undefined;
  }): Promise<CampaignListPage> {
    return this.listPage({ vendorId: input.vendorId }, input.limit, input.cursor);
  }

  async listPublic(input: {
    limit: number;
    cursor?: string | undefined;
  }): Promise<CampaignListPage> {
    return this.listPage({ status: { not: 'DRAFT' } }, input.limit, input.cursor);
  }

  private async listPage(
    where: Prisma.PreorderCampaignWhereInput,
    limit: number,
    cursor: string | undefined,
  ): Promise<CampaignListPage> {
    const take = limit + 1;
    const rows = await this.prisma.preorderCampaign.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: page.map(toDomain),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      hasMore,
    };
  }

  async update(campaign: PreorderCampaign): Promise<void> {
    await this.prisma.preorderCampaign.update({
      where: { id: campaign.id },
      data: toRow(campaign),
    });
  }

  async decrementRemainingIfAvailable(id: CampaignId, quantity: number): Promise<boolean> {
    const result = await this.prisma.preorderCampaign.updateMany({
      where: { id, status: 'OPEN', remainingQuantity: { gte: quantity } },
      data: { remainingQuantity: { decrement: quantity } },
    });
    return result.count === 1;
  }

  async incrementRemaining(id: CampaignId, quantity: number): Promise<void> {
    await this.prisma.preorderCampaign.updateMany({
      where: { id },
      data: { remainingQuantity: { increment: quantity } },
    });
  }

  async listByStatusDue(
    status: CampaignStatusName,
    field: 'opensAt' | 'orderCutoffAt' | 'fulfilmentWindowStart',
    asOf: Date,
    limit: number,
  ): Promise<readonly PreorderCampaign[]> {
    const rows = await this.prisma.preorderCampaign.findMany({
      where: { status, [field]: { lte: asOf } },
      orderBy: { [field]: 'asc' },
      take: limit,
    });
    return rows.map(toDomain);
  }

  async listDraft(limit: number): Promise<readonly PreorderCampaign[]> {
    const rows = await this.prisma.preorderCampaign.findMany({
      where: { status: 'DRAFT' },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return rows.map(toDomain);
  }

  async listSoldOutCandidates(limit: number): Promise<readonly PreorderCampaign[]> {
    const rows = await this.prisma.preorderCampaign.findMany({
      where: { status: 'OPEN', remainingQuantity: { lte: 0 } },
      orderBy: { updatedAt: 'asc' },
      take: limit,
    });
    return rows.map(toDomain);
  }

  async listOpen(limit: number): Promise<readonly PreorderCampaign[]> {
    const rows = await this.prisma.preorderCampaign.findMany({
      where: { status: 'OPEN' },
      orderBy: { id: 'asc' },
      take: limit,
    });
    return rows.map(toDomain);
  }
}
