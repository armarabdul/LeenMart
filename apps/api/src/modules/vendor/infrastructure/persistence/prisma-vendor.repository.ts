import type { PrismaClient } from '@prisma/client';
import { toUserId, toVendorId, type UserId, type VendorId } from '../../../identity/index.js';
import { VendorProfile } from '../../domain/entities/vendor-profile.entity.js';
import { VendorStatus } from '../../domain/value-objects/vendor-status.value-object.js';
import type { VendorRepository } from '../../domain/repositories/vendor.repository.js';

interface VendorProfileRow {
  readonly id: string;
  readonly userId: string;
  readonly status: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const toDomain = (row: VendorProfileRow): VendorProfile =>
  VendorProfile.reconstitute({
    id: toVendorId(row.id),
    userId: toUserId(row.userId),
    status: VendorStatus.fromName(row.status),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

/** Maps rows to `VendorProfile` at the boundary; Prisma types never escape this file (SDD 3.4). */
export class PrismaVendorRepository implements VendorRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(vendorProfile: VendorProfile): Promise<void> {
    await this.prisma.vendorProfile.create({
      data: {
        id: vendorProfile.id,
        userId: vendorProfile.userId,
        status: vendorProfile.status.name,
        createdAt: vendorProfile.createdAt,
        updatedAt: vendorProfile.updatedAt,
      },
    });
  }

  /**
   * Writes only the lifecycle state — `id`/`userId` are immutable, and
   * `createdAt` is set once at registration. Mirrors the narrow-update
   * convention `PrismaUserRepository`/`PrismaOtpRepository` already follow.
   */
  async update(vendorProfile: VendorProfile): Promise<void> {
    await this.prisma.vendorProfile.update({
      where: { id: vendorProfile.id },
      data: {
        status: vendorProfile.status.name,
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
