import { Prisma, type PrismaClient } from '@prisma/client';
import { toUserId, type UserId } from '../../../identity/index.js';
import { Address } from '../../domain/entities/address.entity.js';
import { AddressDefaultConflictError } from '../../domain/errors/customer-errors.js';
import type { AddressRepository } from '../../domain/repositories/address.repository.js';
import { toAddressId, type AddressId } from '../../domain/value-objects/address-id.value-object.js';

/** Prisma's unique-constraint-violation code — here, always `idx_addresses_one_default_per_user`. */
const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

interface AddressRow {
  readonly id: string;
  readonly userId: string;
  readonly recipientName: string;
  readonly phone: string;
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly state: string;
  readonly pincode: string;
  readonly landmark: string | null;
  readonly label: string;
  readonly isDefault: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const toDomain = (row: AddressRow): Address =>
  Address.reconstitute({
    id: toAddressId(row.id),
    userId: toUserId(row.userId),
    recipientName: row.recipientName,
    phone: row.phone,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    state: row.state,
    pincode: row.pincode,
    landmark: row.landmark,
    label: row.label,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

/** Maps rows to `Address` at the boundary; Prisma types never escape this file (SDD 3.4). Every query filters `deletedAt: null` (soft delete). */
export class PrismaAddressRepository implements AddressRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(address: Address): Promise<void> {
    await this.prisma.address.create({
      data: {
        id: address.id,
        userId: address.userId,
        recipientName: address.recipientName,
        phone: address.phone,
        line1: address.line1,
        line2: address.line2,
        city: address.city,
        state: address.state,
        pincode: address.pincode,
        landmark: address.landmark,
        label: address.label,
        isDefault: address.isDefault,
      },
    });
  }

  async findById(id: AddressId, userId: UserId): Promise<Address | null> {
    const row = await this.prisma.address.findFirst({
      where: { id, userId, deletedAt: null },
    });
    return row ? toDomain(row) : null;
  }

  async findAllByUserId(userId: UserId): Promise<readonly Address[]> {
    const rows = await this.prisma.address.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map(toDomain);
  }

  async update(address: Address, userId: UserId): Promise<boolean> {
    const result = await this.prisma.address.updateMany({
      where: { id: address.id, userId, deletedAt: null },
      data: {
        recipientName: address.recipientName,
        phone: address.phone,
        line1: address.line1,
        line2: address.line2,
        city: address.city,
        state: address.state,
        pincode: address.pincode,
        landmark: address.landmark,
        label: address.label,
      },
    });
    return result.count === 1;
  }

  async remove(id: AddressId, userId: UserId, now: Date): Promise<boolean> {
    const result = await this.prisma.address.updateMany({
      where: { id, userId, deletedAt: null },
      data: { deletedAt: now, isDefault: false },
    });
    return result.count === 1;
  }

  async setDefault(id: AddressId, userId: UserId, now: Date): Promise<boolean> {
    // Array-form `$transaction`: the only way to guarantee "clear the old
    // default, set the new one" never leaves a customer with zero defaults
    // if the process dies between the two statements. The partial unique
    // index is what stops two *concurrent* callers from both succeeding —
    // whichever commits second hits it and throws, caught below — this
    // transaction is what stops a single call from partially applying.
    try {
      const [, updateResult] = await this.prisma.$transaction([
        this.prisma.address.updateMany({
          where: { userId, isDefault: true, deletedAt: null },
          data: { isDefault: false },
        }),
        this.prisma.address.updateMany({
          where: { id, userId, deletedAt: null },
          data: { isDefault: true, updatedAt: now },
        }),
      ]);
      return updateResult.count === 1;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new AddressDefaultConflictError();
      }
      throw error;
    }
  }
}
