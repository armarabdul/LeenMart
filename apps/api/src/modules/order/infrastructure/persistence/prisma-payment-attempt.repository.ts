import type { PrismaClient } from '@prisma/client';
import { Money, type TransactionScope } from '@leen-mart/domain-kit';
import { PaymentAttempt } from '../../domain/entities/payment-attempt.entity.js';
import type { PaymentProvider } from '../../domain/entities/payment-attempt.entity.js';
import { PaymentAttemptStatus } from '../../domain/value-objects/payment-attempt-status.value-object.js';
import { toPaymentAttemptId } from '../../domain/value-objects/payment-attempt-id.value-object.js';
import { toOrderId } from '../../domain/value-objects/order-id.value-object.js';
import type { PaymentAttemptRepository } from '../../domain/repositories/payment-attempt.repository.js';
import type { OrderId } from '../../domain/value-objects/order-id.value-object.js';

interface PaymentAttemptRow {
  readonly id: string;
  readonly orderId: string;
  readonly status: string;
  readonly amount: bigint;
  readonly currency: string;
  readonly provider: string;
  readonly providerReference: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const toDomain = (row: PaymentAttemptRow): PaymentAttempt =>
  PaymentAttempt.reconstitute({
    id: toPaymentAttemptId(row.id),
    orderId: toOrderId(row.orderId),
    status: PaymentAttemptStatus.fromName(row.status),
    amount: Money.fromMinor(row.amount, row.currency as 'INR'),
    provider: row.provider as PaymentProvider,
    providerReference: row.providerReference,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

/**
 * `payment_attempts` (S3-3B). Bound to `leenmart_checkout` — customer-owned,
 * no RLS, ownership enforced by joining through `orderId` to the caller's
 * own `orders` row, the same convention `PrismaOrderRepository` already
 * establishes.
 */
export class PrismaPaymentAttemptRepository implements PaymentAttemptRepository {
  constructor(private readonly prisma: PrismaClient) {}

  withTransaction(scope: TransactionScope): PaymentAttemptRepository {
    return new PrismaPaymentAttemptRepository(scope as unknown as PrismaClient);
  }

  async create(attempt: PaymentAttempt): Promise<void> {
    await this.prisma.paymentAttempt.create({
      data: {
        id: attempt.id,
        orderId: attempt.orderId,
        status: attempt.status.name,
        amount: attempt.amount.amountMinor,
        currency: attempt.amount.currency,
        provider: attempt.provider,
        providerReference: attempt.providerReference,
        createdAt: attempt.createdAt,
        updatedAt: attempt.updatedAt,
      },
    });
  }

  async findInitiatedByOrderId(orderId: OrderId): Promise<PaymentAttempt | null> {
    const row = await this.prisma.paymentAttempt.findFirst({
      where: { orderId, status: 'INITIATED' },
      orderBy: { createdAt: 'desc' },
    });
    return row ? toDomain(row) : null;
  }

  async updateStatus(attempt: PaymentAttempt): Promise<void> {
    await this.prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: { status: attempt.status.name, updatedAt: attempt.updatedAt },
    });
  }
}
