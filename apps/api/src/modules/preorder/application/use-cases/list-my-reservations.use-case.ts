import type { UserId } from '../../../identity/index.js';
import type {
  ReservationListPage,
  ReservationRepository,
} from '../../domain/repositories/reservation.repository.js';

export interface ListMyReservationsDeps {
  readonly reservationRepository: ReservationRepository;
}

/** "My Preorder Reservations" — mirrors `ListOrdersUseCase`. */
export class ListMyReservationsUseCase {
  constructor(private readonly deps: ListMyReservationsDeps) {}

  execute(input: {
    customerId: UserId;
    limit: number;
    cursor?: string | undefined;
  }): Promise<ReservationListPage> {
    return this.deps.reservationRepository.listByCustomerId({
      customerId: input.customerId,
      limit: input.limit,
      cursor: input.cursor,
    });
  }
}
