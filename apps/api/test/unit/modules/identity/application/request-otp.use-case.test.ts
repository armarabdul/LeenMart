import { describe, expect, it } from 'vitest';
import { FixedClock, UuidV4Generator } from '@leen-mart/domain-kit';
import { RequestOtpUseCase } from '../../../../../src/modules/identity/application/use-cases/request-otp.use-case.js';
import { PhoneNumber } from '../../../../../src/modules/identity/domain/value-objects/phone-number.value-object.js';
import { User } from '../../../../../src/modules/identity/domain/entities/user.entity.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import {
  FakeOtpGenerator,
  FakeOtpHasher,
  InMemoryOtpRepository,
  InMemoryUserRepository,
  nullLogger,
} from './fakes.js';

const PHONE = '+919876543210';

const setup = (): {
  useCase: RequestOtpUseCase;
  userRepository: InMemoryUserRepository;
  otpRepository: InMemoryOtpRepository;
  otpHasher: FakeOtpHasher;
} => {
  const clock = new FixedClock(new Date('2026-01-01T00:00:00.000Z'));
  const idGenerator = new UuidV4Generator();
  const userRepository = new InMemoryUserRepository();
  const otpRepository = new InMemoryOtpRepository();
  const otpGenerator = new FakeOtpGenerator(['004281']);
  const otpHasher = new FakeOtpHasher();

  const useCase = new RequestOtpUseCase({
    userRepository,
    otpGenerator,
    otpHasher,
    otpRepository,
    idGenerator,
    clock,
    logger: nullLogger,
  });

  return { useCase, userRepository, otpRepository, otpHasher };
};

describe('RequestOtpUseCase', () => {
  it('creates a PENDING customer when the phone is new', async () => {
    const { useCase, userRepository } = setup();

    await useCase.execute({ phone: PHONE });

    const user = await userRepository.findByPhone(PhoneNumber.create(PHONE));
    expect(user).not.toBeNull();
    expect(user?.status.name).toBe('PENDING');
    expect(user?.role.name).toBe('CUSTOMER');
    expect(user?.phoneVerifiedAt).toBeNull();
  });

  it('does not create a duplicate user when the phone already exists', async () => {
    const { useCase, userRepository } = setup();
    const existing = User.registerWithPhone({
      id: toUserId('00000000-0000-7000-8000-000000000030'),
      phone: PhoneNumber.create(PHONE),
      now: new Date('2025-01-01T00:00:00.000Z'),
    });
    await userRepository.create(existing);

    await useCase.execute({ phone: PHONE });

    const user = await userRepository.findByPhone(PhoneNumber.create(PHONE));
    expect(user?.id).toBe(existing.id);
  });

  it('creates an OTP for the user, hashing the generated code', async () => {
    const { useCase, userRepository, otpRepository } = setup();

    await useCase.execute({ phone: PHONE });

    const user = await userRepository.findByPhone(PhoneNumber.create(PHONE));
    const otp = await otpRepository.findActiveByUserId(user!.id);
    expect(otp).not.toBeNull();
    expect(otp?.codeHash).toBe('hashed:004281');
  });

  it('never persists the plaintext OTP', async () => {
    const { useCase, userRepository, otpRepository } = setup();

    await useCase.execute({ phone: PHONE });

    const user = await userRepository.findByPhone(PhoneNumber.create(PHONE));
    const otp = await otpRepository.findActiveByUserId(user!.id);
    expect(otp?.codeHash).not.toBe('004281');
    expect(otp?.codeHash).not.toMatch(/^\d{6}$/);
  });

  it('never returns the plaintext OTP', async () => {
    const { useCase } = setup();

    const result = await useCase.execute({ phone: PHONE });

    expect(result).toBeUndefined();
  });

  it('issues the OTP with a fresh 5-minute expiry from the current clock', async () => {
    const { useCase, userRepository, otpRepository } = setup();

    await useCase.execute({ phone: PHONE });

    const user = await userRepository.findByPhone(PhoneNumber.create(PHONE));
    const otp = await otpRepository.findActiveByUserId(user!.id);
    expect(otp?.expiresAt).toEqual(new Date('2026-01-01T00:05:00.000Z'));
    expect(otp?.attempts).toBe(0);
    expect(otp?.consumedAt).toBeNull();
  });
});
