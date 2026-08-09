import type { Clock, IdGenerator, Logger } from '@leen-mart/domain-kit';
import { User } from '../../domain/entities/user.entity.js';
import { EmailAlreadyRegisteredError } from '../../domain/errors/identity-errors.js';
import { toUserId } from '../../domain/value-objects/user-id.value-object.js';
import type { PasswordHasher } from '../ports/password-hasher.port.js';
import type { UserRepository } from '../ports/user-repository.port.js';
import type { AuthSession, SessionIssuer } from '../services/session-issuer.service.js';

export interface RegisterCustomerInput {
  readonly email: string;
  readonly password: string;
}

export interface RegisterCustomerDeps {
  readonly userRepository: UserRepository;
  readonly passwordHasher: PasswordHasher;
  readonly sessionIssuer: SessionIssuer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
}

/** Self-service sign-up. Always creates a CUSTOMER — there is no field a client can set to become VENDOR/ADMIN. */
export class RegisterCustomerUseCase {
  constructor(private readonly deps: RegisterCustomerDeps) {}

  async execute(input: RegisterCustomerInput): Promise<AuthSession> {
    const { userRepository, passwordHasher, sessionIssuer, idGenerator, clock, logger } = this.deps;

    const existing = await userRepository.findByEmail(input.email);
    if (existing) {
      throw new EmailAlreadyRegisteredError();
    }

    const passwordHash = await passwordHasher.hash(input.password);
    const user = User.register({
      id: toUserId(idGenerator.generate()),
      email: input.email,
      passwordHash,
      now: clock.now(),
    });
    await userRepository.create(user);

    logger.info({ userId: user.id }, 'Customer registered');
    return sessionIssuer.issueFor(user);
  }
}
