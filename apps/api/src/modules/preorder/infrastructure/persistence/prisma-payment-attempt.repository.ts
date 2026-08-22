import { Money, type TransactionScope } from '@leen-mart/domain-kit';
import type { Prisma, PrismaClient } from '@prisma/client';
import { PreorderPaymentAttempt } from '../../domain/entities/preorder-payment-attempt.entity.js';
import type { PaymentAttemptRepository } from '../../domain/repositories/payment-attempt.repository.js';
import {
  toPreorderPaymentAttemptId,
  type PreorderPaymentAttemptId,
} from '../../domain/value-objects/payment-attempt-id.value-object.js';
import {
  toReservationId,
  type ReservationId,
} from '../../domain/value-objects/reservation-id.value-object.js';
import { PaymentAttemptStatus } from '../../domain/value-objects/payment-attempt-status.value-object.js';

type Row = Prisma.PreorderPaymentAttemptGetPayload<Record<string, never>>;

const toDomain = (row: Row): PreorderPaymentAttempt =>
  PreorderPaymentAttempt.reconstitute({
    id: toPreorderPaymentAttemptId(row.id),
    reservationId: toReservationId(row.reservationId),
    kind: row.kind,
    status: PaymentAttemptStatus.fromName(row.status),
    amount: Money.fromMinor(row.amount, row.currency as 'INR'),
    provider: row.provider as 'MOCK',
    providerReference: row.providerReference ?? '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

export class PrismaPaymentAttemptRepository implements PaymentAttemptRepository {
  constructor(private readonly prisma: PrismaClient) {}

  withTransaction(scope: TransactionScope): PaymentAttemptRepository {
    return new PrismaPaymentAttemptRepository(scope as unknown as PrismaClient);
  }

  async create(attempt: PreorderPaymentAttempt): Promise<void> {
    await this.prisma.preorderPaymentAttempt.create({
      data: {
        id: attempt.id,
        reservationId: attempt.reservationId,
        kind: attempt.kind,
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

  async findById(id: PreorderPaymentAttemptId): Promise<PreorderPaymentAttempt | null> {
    const row = await this.prisma.preorderPaymentAttempt.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByProviderReference(providerReference: string): Promise<PreorderPaymentAttempt | null> {
    const row = await this.prisma.preorderPaymentAttempt.findFirst({
      where: { providerReference },
    });
    return row ? toDomain(row) : null;
  }

  async findInitiatedByReservationAndKind(
    reservationId: ReservationId,
    kind: 'ADVANCE' | 'BALANCE',
  ): Promise<PreorderPaymentAttempt | null> {
    const row = await this.prisma.preorderPaymentAttempt.findFirst({
      where: { reservationId, kind, status: 'INITIATED' },
      orderBy: { createdAt: 'desc' },
    });
    return row ? toDomain(row) : null;
  }

  async update(attempt: PreorderPaymentAttempt): Promise<void> {
    await this.prisma.preorderPaymentAttempt.update({
      where: { id: attempt.id },
      data: { status: attempt.status.name, updatedAt: attempt.updatedAt },
    });
  }

  async listByReservationId(
    reservationId: ReservationId,
  ): Promise<readonly PreorderPaymentAttempt[]> {
    const rows = await this.prisma.preorderPaymentAttempt.findMany({
      where: { reservationId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toDomain);
  }
}
