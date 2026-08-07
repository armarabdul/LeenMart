import type { Logger } from '@leen-mart/domain-kit';
import { InvalidCredentialsError } from '../../domain/errors/identity-errors.js';
import type { PasswordHasher } from '../ports/password-hasher.port.js';
import type { UserRepository } from '../ports/user-repository.port.js';
import type { AuthSession, SessionIssuer } from '../services/session-issuer.service.js';

export interface LoginInput {
  readonly email: string;
  readonly password: string;
}

export interface LoginDeps {
  readonly userRepository: UserRepository;
  readonly passwordHasher: PasswordHasher;
  readonly sessionIssuer: SessionIssuer;
  readonly logger: Logger;
}

export class LoginUseCase {
  constructor(private readonly deps: LoginDeps) {}

  async execute(input: LoginInput): Promise<AuthSession> {
    const { userRepository, passwordHasher, sessionIssuer, logger } = this.deps;

    const user = await userRepository.findByEmail(input.email);
    if (!user) {
      logger.warn({ email: input.email }, 'Login failed: unknown email');
      throw new InvalidCredentialsError();
    }

    const passwordValid = await passwordHasher.verify(user.passwordHash, input.password);
    if (!passwordValid) {
      logger.warn({ userId: user.id }, 'Login failed: wrong password');
      throw new InvalidCredentialsError();
    }

    logger.info({ userId: user.id }, 'Login succeeded');
    return sessionIssuer.issueFor(user);
  }
}
