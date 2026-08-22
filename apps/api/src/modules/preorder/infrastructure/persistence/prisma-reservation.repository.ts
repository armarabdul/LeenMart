import { Money, type TransactionScope } from '@leen-mart/domain-kit';
import type { Prisma, PrismaClient } from '@prisma/client';
import { toAddressId } from '../../../customer/index.js';
import { toUserId, toVendorId, type UserId, type VendorId } from '../../../identity/index.js';
import {
  PreorderReservation,
  type ReservationFulfilmentMode,
} from '../../domain/entities/preorder-reservation.entity.js';
import type {
  ReservationListPage,
  ReservationRepository,
} from '../../domain/repositories/reservation.repository.js';
import {
  toCampaignId,
  type CampaignId,
} from '../../domain/value-objects/campaign-id.value-object.js';
import {
  toReservationId,
  type ReservationId,
} from '../../domain/value-objects/reservation-id.value-object.js';
import {
  ReservationStatus,
  type ReservationStatusName,
} from '../../domain/value-objects/reservation-status.value-object.js';

type ReservationRow = Prisma.PreorderReservationGetPayload<Record<string, never>>;

const toDomain = (row: ReservationRow): PreorderReservation =>
  PreorderReservation.reconstitute({
    id: toReservationId(row.id),
    campaignId: toCampaignId(row.campaignId),
    customerId: toUserId(row.customerId),
    vendorId: toVendorId(row.vendorId),
    quantity: row.quantity,
    fulfilmentMode: row.fulfilmentMode as ReservationFulfilmentMode,
    addressId: toAddressId(row.addressId),
    status: ReservationStatus.fromName(row.status),
    unitPrice: Money.fromMinor(row.unitPriceAmount, row.unitPriceCurrency as 'INR'),
    advanceAmount: Money.fromMinor(row.advanceAmount, row.unitPriceCurrency as 'INR'),
    balanceAmount: Money.fromMinor(row.balanceAmount, row.unitPriceCurrency as 'INR'),
    expiresAt: row.expiresAt,
    confirmedAt: row.confirmedAt,
    balancePaidAt: row.balancePaidAt,
    releasedAt: row.releasedAt,
    convertedOrderId: row.convertedOrderId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

interface ReservationRowInput {
  readonly id: ReservationId;
  readonly campaignId: CampaignId;
  readonly customerId: UserId;
  readonly vendorId: VendorId;
  readonly quantity: number;
  readonly fulfilmentMode: ReservationFulfilmentMode;
  readonly addressId: string;
  readonly status: ReservationStatusName;
  readonly unitPriceAmount: bigint;
  readonly unitPriceCurrency: string;
  readonly advanceAmount: bigint;
  readonly balanceAmount: bigint;
  readonly expiresAt: Date;
  readonly confirmedAt: Date | null;
  readonly balancePaidAt: Date | null;
  readonly releasedAt: Date | null;
  readonly convertedOrderId: string | null;
  readonly updatedAt: Date;
}

const toRow = (reservation: PreorderReservation): ReservationRowInput => ({
  id: reservation.id,
  campaignId: reservation.campaignId,
  customerId: reservation.customerId,
  vendorId: reservation.vendorId,
  quantity: reservation.quantity,
  fulfilmentMode: reservation.fulfilmentMode,
  addressId: reservation.addressId,
  status: reservation.status.name,
  unitPriceAmount: reservation.unitPrice.amountMinor,
  unitPriceCurrency: reservation.unitPrice.currency,
  advanceAmount: reservation.advanceAmount.amountMinor,
  balanceAmount: reservation.balanceAmount.amountMinor,
  expiresAt: reservation.expiresAt,
  confirmedAt: reservation.confirmedAt,
  balancePaidAt: reservation.balancePaidAt,
  releasedAt: reservation.releasedAt,
  convertedOrderId: reservation.convertedOrderId,
  updatedAt: reservation.updatedAt,
});

/**
 * Customer-owned, written exclusively through `leenmart_checkout` (P6 of the
 * migration's own doc comment) — ownership enforced by `(id, customerId)`
 * scoping in every method, the same `PrismaOrderRepository`/
 * `PrismaCartRepository` precedent, never by an RLS policy on this table for
 * that credential. `findByIdAndVendorId` is the one exception: it runs on
 * the wrapped `leenmart_app` client for the vendor's own read, where
 * `preorder_reservations_vendor_select` RLS is the actual enforcement and
 * this repository's own `WHERE vendorId` is defence-in-depth on top of it.
 */
export class PrismaReservationRepository implements ReservationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  withTransaction(scope: TransactionScope): ReservationRepository {
    return new PrismaReservationRepository(scope as unknown as PrismaClient);
  }

  async create(reservation: PreorderReservation): Promise<void> {
    await this.prisma.preorderReservation.create({
      data: { ...toRow(reservation), createdAt: reservation.createdAt },
    });
  }

  async findById(id: ReservationId): Promise<PreorderReservation | null> {
    const row = await this.prisma.preorderReservation.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByIdAndCustomerId(
    id: ReservationId,
    customerId: UserId,
  ): Promise<PreorderReservation | null> {
    const row = await this.prisma.preorderReservation.findFirst({ where: { id, customerId } });
    return row ? toDomain(row) : null;
  }

  async findByIdAndVendorId(
    id: ReservationId,
    vendorId: VendorId,
  ): Promise<PreorderReservation | null> {
    const row = await this.prisma.preorderReservation.findFirst({ where: { id, vendorId } });
    return row ? toDomain(row) : null;
  }

  async listByCustomerId(input: {
    customerId: UserId;
    limit: number;
    cursor?: string | undefined;
  }): Promise<ReservationListPage> {
    return this.listPage({ customerId: input.customerId }, input.limit, input.cursor);
  }

  async listByCampaignId(input: {
    campaignId: CampaignId;
    limit: number;
    cursor?: string | undefined;
  }): Promise<ReservationListPage> {
    return this.listPage({ campaignId: input.campaignId }, input.limit, input.cursor);
  }

  private async listPage(
    where: Prisma.PreorderReservationWhereInput,
    limit: number,
    cursor: string | undefined,
  ): Promise<ReservationListPage> {
    const take = limit + 1;
    const rows = await this.prisma.preorderReservation.findMany({
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

  async sumActiveQuantityForCustomer(campaignId: CampaignId, customerId: UserId): Promise<number> {
    const result = await this.prisma.preorderReservation.aggregate({
      where: { campaignId, customerId, status: { in: ['PENDING', 'CONFIRMED'] } },
      _sum: { quantity: true },
    });
    return result._sum.quantity ?? 0;
  }

  async updateIfStatus(
    reservation: PreorderReservation,
    expectedStatus: ReservationStatusName,
  ): Promise<boolean> {
    const result = await this.prisma.preorderReservation.updateMany({
      where: { id: reservation.id, status: expectedStatus },
      data: toRow(reservation),
    });
    return result.count === 1;
  }

  async update(reservation: PreorderReservation): Promise<void> {
    await this.prisma.preorderReservation.update({
      where: { id: reservation.id },
      data: toRow(reservation),
    });
  }

  async listExpiredPending(asOf: Date, limit: number): Promise<readonly PreorderReservation[]> {
    const rows = await this.prisma.preorderReservation.findMany({
      where: { status: 'PENDING', expiresAt: { lte: asOf } },
      orderBy: { expiresAt: 'asc' },
      take: limit,
    });
    return rows.map(toDomain);
  }

  async summarizeByCampaign(campaignId: CampaignId): Promise<{
    reservationCount: number;
    confirmedCount: number;
    totalUnitsCommitted: number;
  }> {
    const [total, confirmed] = await Promise.all([
      this.prisma.preorderReservation.aggregate({
        where: { campaignId, status: { in: ['PENDING', 'CONFIRMED'] } },
        _count: { _all: true },
        _sum: { quantity: true },
      }),
      this.prisma.preorderReservation.count({ where: { campaignId, status: 'CONFIRMED' } }),
    ]);
    return {
      reservationCount: total._count._all,
      confirmedCount: confirmed,
      totalUnitsCommitted: total._sum.quantity ?? 0,
    };
  }
}
