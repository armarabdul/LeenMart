import type { TransactionScope } from '@leen-mart/domain-kit';
import type { PrismaClient } from '@prisma/client';
import { toUserId, toVendorId, type UserId, type VendorId } from '../../../identity/index.js';
import { VendorProfile, type VendorPlanName } from '../../domain/entities/vendor-profile.entity.js';
import { VendorStatus } from '../../domain/value-objects/vendor-status.value-object.js';
import type { VendorRepository } from '../../domain/repositories/vendor.repository.js';

interface VendorProfileRow {
  readonly id: string;
  readonly userId: string;
  readonly status: string;
  readonly plan: VendorPlanName;
  readonly shopName: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const toDomain = (row: VendorProfileRow): VendorProfile =>
  VendorProfile.reconstitute({
    id: toVendorId(row.id),
    userId: toUserId(row.userId),
    status: VendorStatus.fromName(row.status),
    plan: row.plan,
    shopName: row.shopName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

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
        createdAt: vendorProfile.createdAt,
        updatedAt: vendorProfile.updatedAt,
      },
    });
  }

  /**
   * Writes the lifecycle state and shop name — `id`/`userId`/`plan` are
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
