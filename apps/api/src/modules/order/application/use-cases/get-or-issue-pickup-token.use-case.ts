import { createHash } from 'node:crypto';
import type { IdGenerator, Logger } from '@leen-mart/domain-kit';
import type { Principal } from '../../../identity/index.js';
import { PickupToken } from '../../domain/entities/pickup-token.entity.js';
import {
  FulfilmentModeMismatchError,
  OrderNotFoundError,
  PickupTokenNotAvailableError,
  SubOrderNotFoundError,
} from '../../domain/errors/order-errors.js';
import type { OrderRepository } from '../../domain/repositories/order.repository.js';
import type { PickupTokenRepository } from '../../domain/repositories/pickup-token.repository.js';
import { toPickupTokenId } from '../../domain/value-objects/pickup-token-id.value-object.js';
import type { OrderId } from '../../domain/value-objects/order-id.value-object.js';
import type { SubOrderId } from '../../domain/value-objects/sub-order-id.value-object.js';
import type { PickupTokenSigner } from '../ports/pickup-token-signer.port.js';

export interface GetOrIssuePickupTokenInput {
  readonly principal: Principal;
  readonly orderId: OrderId;
  readonly subOrderId: SubOrderId;
}

export interface IssuedPickupToken {
  readonly token: string;
  readonly expiresAt: Date;
}

export interface GetOrIssuePickupTokenDeps {
  readonly orderRepository: OrderRepository;
  /** Bound to `leenmart_checkout` — the customer's own issue/rotate path, per the port's own doc comment. */
  readonly pickupTokenRepository: PickupTokenRepository;
  readonly pickupTokenSigner: PickupTokenSigner;
  readonly idGenerator: IdGenerator;
  readonly logger: Logger;
}

/**
 * The customer's own QR/token view (S4-QR, SDD §13.1's 60-second rotation).
 * `VIEW_OWN_ORDERS` — no new permission, since this is the pickup-mode
 * analogue of reading the order's own status, scoped by the same
 * `findByIdAndCustomerId` ownership check `GetOrderUseCase` already uses
 * (SEC-06: never distinguishes "no such order" from "not yours").
 *
 * Issues a fresh token on first call, then rotates the same row on every
 * later call (no dedicated "rotate" endpoint — the customer PWA simply polls
 * this one on the design confirmation's ~60-second cadence, and a fresh
 * `sign()` naturally produces a fresh nonce and validity window each time).
 * Never touches `status` — only `RedeemPickupTokenUseCase`'s atomic
 * compare-and-set does that (locked decision #17).
 */
export class GetOrIssuePickupTokenUseCase {
  constructor(private readonly deps: GetOrIssuePickupTokenDeps) {}

  async execute(input: GetOrIssuePickupTokenInput): Promise<IssuedPickupToken> {
    const { orderRepository, pickupTokenRepository, pickupTokenSigner, idGenerator, logger } =
      this.deps;
    const { principal, orderId, subOrderId } = input;

    const order = await orderRepository.findByIdAndCustomerId(orderId, principal.userId);
    if (!order) {
      throw new OrderNotFoundError();
    }
    const subOrder = order.subOrders.find((candidate) => candidate.id === subOrderId);
    if (!subOrder) {
      throw new SubOrderNotFoundError();
    }
    if (subOrder.fulfilmentMode.name !== 'PICKUP') {
      throw new FulfilmentModeMismatchError('Pickup token issuance', subOrder.fulfilmentMode.name);
    }
    if (subOrder.status.name !== 'READY_FOR_PICKUP') {
      throw new PickupTokenNotAvailableError(subOrder.status.name);
    }

    const signed = pickupTokenSigner.sign(subOrderId);
    const tokenHash = createHash('sha256').update(signed.token).digest('hex');

    const existing = await pickupTokenRepository.findBySubOrderId(subOrderId);
    if (existing) {
      const rotated = existing.rotate({
        tokenHash,
        nonce: signed.nonce,
        issuedAt: signed.issuedAt,
        expiresAt: signed.expiresAt,
      });
      await pickupTokenRepository.rotate(rotated);
    } else {
      const issued = PickupToken.issue({
        id: toPickupTokenId(idGenerator.generate()),
        subOrderId,
        vendorId: subOrder.vendorId,
        tokenHash,
        nonce: signed.nonce,
        issuedAt: signed.issuedAt,
        expiresAt: signed.expiresAt,
      });
      await pickupTokenRepository.create(issued);
    }

    logger.info({ subOrderId, orderId }, 'Customer issued/rotated their pickup token');
    return { token: signed.token, expiresAt: signed.expiresAt };
  }
}
