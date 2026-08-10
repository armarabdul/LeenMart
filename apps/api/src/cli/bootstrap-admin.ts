import { emailSchema } from '@leen-mart/contracts';
import { createContainer } from '../container.js';
import { Argon2PasswordHasher } from '../modules/identity/infrastructure/security/argon2-password-hasher.js';
import { PrismaUserRepository } from '../modules/identity/infrastructure/persistence/prisma-user.repository.js';
import { BootstrapAdminUseCase } from '../modules/identity/application/use-cases/bootstrap-admin.use-case.js';
import { readHiddenLine, readLine } from './prompt.js';

/**
 * Operator-run creation of the platform's first SUPER_ADMIN (SDD 8.2's
 * chicken-and-egg: only a SUPER_ADMIN may manage admins).
 *
 * Interactive only, by design. The password is never accepted from argv or
 * the environment — both leak into shell history, process listings and
 * deployment config — and is never written to stdout or any log.
 *
 * Run with: pnpm --filter @leen-mart/api bootstrap:admin
 */
const run = async (): Promise<void> => {
  const container = createContainer();

  try {
    const useCase = new BootstrapAdminUseCase({
      userRepository: new PrismaUserRepository(container.prisma),
      passwordHasher: new Argon2PasswordHasher(),
      idGenerator: container.idGenerator,
      clock: container.clock,
      logger: container.logger.child({ module: 'identity', cli: 'bootstrap-admin' }),
    });

    process.stdout.write('Create the first Leen Mart administrator (SUPER_ADMIN).\n\n');

    const email = emailSchema.parse(await readLine('Email: '));
    const password = await readHiddenLine('Password (min 10 characters): ');
    const confirmation = await readHiddenLine('Confirm password: ');

    if (password !== confirmation) {
      throw new Error('The passwords did not match.');
    }

    const admin = await useCase.execute({ email, password });

    process.stdout.write(
      `\nCreated SUPER_ADMIN ${admin.id}.\n` +
        'No MFA secret exists yet — this account must complete TOTP enrolment on the\n' +
        'admin surface before it can sign in (SDD 7.1).\n',
    );
  } finally {
    await container.dispose();
  }
};

run().catch((error: unknown) => {
  // Never echo the submitted credentials — only the failure reason.
  process.stderr.write(
    `Bootstrap failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
