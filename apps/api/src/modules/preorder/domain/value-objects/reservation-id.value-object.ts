import { createIdType, type Brand } from '@leen-mart/domain-kit';

export type ReservationId = Brand<string, 'ReservationId'>;

const reservationId = createIdType('ReservationId');

export const isReservationId = reservationId.is;
export const toReservationId = reservationId.from;
