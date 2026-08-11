import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { IntegrationError } from '@leen-mart/domain-kit';
import type {
  DataKeyCipher,
  EncryptionContext,
  GeneratedDataKey,
} from '../../application/ports/data-key-cipher.port.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;

/**
 * **Development and CI only. This is not encryption of record.**
 *
 * A local stand-in for `KmsDataKeyCipher` so the KYC upload and access flows
 * can be exercised without an AWS account, following the same AES-256-GCM
 * shape `AesGcmMfaSecretCipher` already uses.
 *
 * How it differs from the real thing, and why that matters: the wrapping key
 * lives in an environment variable on the same host as the data it protects,
 * so anything that can read the process environment can unwrap every KYC
 * document. KMS exists precisely so that is not true. SDD 12.1/12.3 require a
 * KMS-managed CMK for KYC, and this class does not satisfy that requirement —
 * it only lets the code around it be written and tested.
 *
 * The constructor refuses to build in production, mirroring the `superRefine`
 * guard `env.ts` already applies to insecure development secrets. That refusal
 * is the whole reason this class can exist in the tree at all.
 *
 * The encryption context is bound as GCM additional authenticated data, so it
 * behaves like KMS's: unwrapping with a different context fails rather than
 * quietly returning the wrong key.
 */
export class DevDataKeyCipher implements DataKeyCipher {
  constructor(
    private readonly wrappingKey: Buffer,
    nodeEnv: string,
  ) {
    if (nodeEnv === 'production') {
      throw new Error(
        'DevDataKeyCipher is a development-only substitute for KMS and must never run in production (SDD 12.1/12.3).',
      );
    }
    if (wrappingKey.length !== KEY_LENGTH_BYTES) {
      throw new RangeError(
        `The development wrapping key must be exactly ${KEY_LENGTH_BYTES} bytes.`,
      );
    }
  }

  generateDataKey(context?: EncryptionContext): Promise<GeneratedDataKey> {
    const plaintext = randomBytes(KEY_LENGTH_BYTES);

    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.wrappingKey, iv);
    if (context) cipher.setAAD(encodeContext(context));
    const sealed = Buffer.concat([cipher.update(plaintext), cipher.final()]);

    // `iv || authTag || sealed`, matching `AesGcmMfaSecretCipher`'s packing so
    // the two blobs read the same way in a debugger.
    const wrapped = Buffer.concat([iv, cipher.getAuthTag(), sealed]);

    return Promise.resolve({ plaintext, wrapped });
  }

  unwrap(wrapped: Buffer, context?: EncryptionContext): Promise<Buffer> {
    if (wrapped.length <= IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES) {
      return Promise.reject(
        new IntegrationError('kms-dev', 'Could not unwrap a data key.', {
          cause: new TypeError('Wrapped key is too short to contain an IV and auth tag.'),
        }),
      );
    }

    const iv = wrapped.subarray(0, IV_LENGTH_BYTES);
    const authTag = wrapped.subarray(IV_LENGTH_BYTES, IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);
    const sealed = wrapped.subarray(IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);

    try {
      const decipher = createDecipheriv(ALGORITHM, this.wrappingKey, iv);
      if (context) decipher.setAAD(encodeContext(context));
      decipher.setAuthTag(authTag);
      return Promise.resolve(Buffer.concat([decipher.update(sealed), decipher.final()]));
    } catch (error) {
      // Tampering, a wrong wrapping key and a mismatched context are all the
      // same answer — GCM cannot tell them apart, and neither should a caller.
      return Promise.reject(
        new IntegrationError('kms-dev', 'Could not unwrap a data key.', { cause: error }),
      );
    }
  }

  shred(plaintext: Buffer): void {
    plaintext.fill(0);
  }
}

/** Deterministic encoding so the same context always produces the same AAD. */
const encodeContext = (context: EncryptionContext): Buffer =>
  Buffer.from(
    Object.keys(context)
      .sort()
      .map((key) => `${key}=${context[key] ?? ''}`)
      .join('&'),
    'utf8',
  );
