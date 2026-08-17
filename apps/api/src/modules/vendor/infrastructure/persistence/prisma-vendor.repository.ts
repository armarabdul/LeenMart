import type { TransactionScope } from '@leen-mart/domain-kit';
import type { PrismaClient } from '@prisma/client';
import { toUserId, toVendorId, type UserId, type VendorId } from '../../../identity/index.js';
import {
  VendorProfile,
  type VendorPlanName,
  type VendorShopAddress,
} from '../../domain/entities/vendor-profile.entity.js';
import { VendorStatus } from '../../domain/value-objects/vendor-status.value-object.js';
import type { VendorRepository } from '../../domain/repositories/vendor.repository.js';

interface VendorProfileRow {
  readonly id: string;
  readonly userId: string;
  readonly status: string;
  readonly plan: VendorPlanName;
  readonly shopName: string | null;
  readonly supportsPickup: boolean;
  readonly shopAddressLine1: string | null;
  readonly shopAddressLine2: string | null;
  readonly shopAddressCity: string | null;
  readonly shopAddressState: string | null;
  readonly shopAddressPincode: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * The five nullable columns collapse back into one all-or-nothing object
 * (S4-ADDR). Keyed off the mandatory parts: they are only ever written as a
 * set, so any one of them being null means "no address set" rather than a
 * partially filled one. `line2` is genuinely optional and so is carried
 * through as-is.
 */
const toShopAddress = (row: VendorProfileRow): VendorShopAddress | null => {
  const { shopAddressLine1, shopAddressCity, shopAddressState, shopAddressPincode } = row;
  if (!shopAddressLine1 || !shopAddressCity || !shopAddressState || !shopAddressPincode) {
    return null;
  }
  return {
    line1: shopAddressLine1,
    line2: row.shopAddressLine2,
    city: shopAddressCity,
    state: shopAddressState,
    pincode: shopAddressPincode,
  };
};

const toDomain = (row: VendorProfileRow): VendorProfile =>
  VendorProfile.reconstitute({
    id: toVendorId(row.id),
    userId: toUserId(row.userId),
    status: VendorStatus.fromName(row.status),
    plan: row.plan,
    shopName: row.shopName,
    supportsPickup: row.supportsPickup,
    shopAddress: toShopAddress(row),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

/** Explodes the domain object back into the flat columns, or clears all five. */
const shopAddressColumns = (
  vendorProfile: VendorProfile,
): {
  shopAddressLine1: string | null;
  shopAddressLine2: string | null;
  shopAddressCity: string | null;
  shopAddressState: string | null;
  shopAddressPincode: string | null;
} => {
  // Read once and branched once, rather than five independent optional
  // chains — identical result, and it keeps this inside the complexity budget.
  const address = vendorProfile.shopAddress;
  return {
    shopAddressLine1: address === null ? null : address.line1,
    shopAddressLine2: address === null ? null : address.line2,
    shopAddressCity: address === null ? null : address.city,
    shopAddressState: address === null ? null : address.state,
    shopAddressPincode: address === null ? null : address.pincode,
  };
};

/** Maps rows to `VendorProfile` at the boundary; Prisma types never escape this file (SDD 3.4). */
export class PrismaVendorRepository implements VendorRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Unwraps the opaque scope back into the Prisma transaction client it
   * actually is. The cast is confined to this layer on purpose: the port
   * cannot name `PrismaClient` (SDD 2.3 forbids the domain and application
   * layers from importing Prisma), and the only way to obtain a
   * `TransactionScope` is from `TransactionRunner.run`, so nothing else can
   * fabricate one.
   */
  withTransaction(scope: TransactionScope): VendorRepository {
    return new PrismaVendorRepository(scope as unknown as PrismaClient);
  }

  async create(vendorProfile: VendorProfile): Promise<void> {
    await this.prisma.vendorProfile.create({
      data: {
        id: vendorProfile.id,
        userId: vendorProfile.userId,
        status: vendorProfile.status.name,
        plan: vendorProfile.plan,
        shopName: vendorProfile.shopName,
        supportsPickup: vendorProfile.supportsPickup,
        ...shopAddressColumns(vendorProfile),
        createdAt: vendorProfile.createdAt,
        updatedAt: vendorProfile.updatedAt,
      },
    });
  }

  /**
   * Writes the lifecycle state, shop name, pickup capability and shop
   * address — `id`/`userId`/`plan` are
   * immutable here (plan changes are S3-2's own deliberately-withheld
   * concern), and `createdAt` is set once at registration. Mirrors the
   * narrow-update convention `PrismaUserRepository`/`PrismaOtpRepository`
   * already follow.
   */
  async update(vendorProfile: VendorProfile): Promise<void> {
    await this.prisma.vendorProfile.update({
      where: { id: vendorProfile.id },
      data: {
        status: vendorProfile.status.name,
        shopName: vendorProfile.shopName,
        supportsPickup: vendorProfile.supportsPickup,
        ...shopAddressColumns(vendorProfile),
        updatedAt: vendorProfile.updatedAt,
      },
    });
  }

  async findById(id: VendorId): Promise<VendorProfile | null> {
    const row = await this.prisma.vendorProfile.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByUserId(userId: UserId): Promise<VendorProfile | null> {
    const row = await this.prisma.vendorProfile.findUnique({ where: { userId } });
    return row ? toDomain(row) : null;
  }
}
