import type { UserId } from '../../../identity/index.js';
import type { PreorderReservation } from '../../domain/entities/preorder-reservation.entity.js';
import { ReservationNotFoundError } from '../../domain/errors/preorder-errors.js';
import type { ReservationRepository } from '../../domain/repositories/reservation.repository.js';
import type { ReservationId } from '../../domain/value-objects/reservation-id.value-object.js';

export interface GetReservationDeps {
  readonly reservationRepository: ReservationRepository;
}

/** Ownership-scoped by construction — never a bare `id` lookup (IDOR protection, mirrors `GetOrderUseCase`). */
export class GetReservationUseCase {
  constructor(private readonly deps: GetReservationDeps) {}

  async execute(input: {
    customerId: UserId;
    reservationId: ReservationId;
  }): Promise<PreorderReservation> {
    const reservation = await this.deps.reservationRepository.findByIdAndCustomerId(
      input.reservationId,
      input.customerId,
    );
    if (!reservation) throw new ReservationNotFoundError();
    return reservation;
  }
}
