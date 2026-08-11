import { DecryptCommand, GenerateDataKeyCommand, type KMSClient } from '@aws-sdk/client-kms';
import { IntegrationError } from '@leen-mart/domain-kit';
import type {
  DataKeyCipher,
  EncryptionContext,
  GeneratedDataKey,
} from '../../application/ports/data-key-cipher.port.js';

export interface KmsDataKeyCipherConfig {
  /** The customer master key that wraps every KYC data key (SDD 12.3). */
  readonly keyId: string;
}

/**
 * The production `DataKeyCipher` (SDD 12.1/12.3): a KMS-managed CMK wraps a
 * fresh AES-256 data key for every object.
 *
 * The CMK never leaves KMS. What this class handles is the wrapped blob and,
 * briefly, the plaintext key on its way to the client that will do the actual
 * encryption — client-side, per SDD 12.3.
 *
 * The `KMSClient` is injected, which is what lets these paths be tested
 * without credentials or a network: a stub client is indistinguishable from a
 * real one here. There is no branch on environment in this class.
 */
export class KmsDataKeyCipher implements DataKeyCipher {
  constructor(
    private readonly client: KMSClient,
    private readonly config: KmsDataKeyCipherConfig,
  ) {}

  async generateDataKey(context?: EncryptionContext): Promise<GeneratedDataKey> {
    try {
      const result = await this.client.send(
        new GenerateDataKeyCommand({
          KeyId: this.config.keyId,
          KeySpec: 'AES_256',
          ...(context ? { EncryptionContext: { ...context } } : {}),
        }),
      );

      if (!result.Plaintext || !result.CiphertextBlob) {
        throw new TypeError('KMS returned a data key without both halves.');
      }

      return {
        plaintext: Buffer.from(result.Plaintext),
        wrapped: Buffer.from(result.CiphertextBlob),
      };
    } catch (error) {
      // The message deliberately carries nothing from the KMS response —
      // `cause` is retained for logs, which never include key material.
      throw new IntegrationError('kms', 'Could not generate a data key.', { cause: error });
    }
  }

  async unwrap(wrapped: Buffer, context?: EncryptionContext): Promise<Buffer> {
    try {
      const result = await this.client.send(
        new DecryptCommand({
          KeyId: this.config.keyId,
          CiphertextBlob: wrapped,
          ...(context ? { EncryptionContext: { ...context } } : {}),
        }),
      );

      if (!result.Plaintext) {
        throw new TypeError('KMS returned no plaintext for a wrapped data key.');
      }

      return Buffer.from(result.Plaintext);
    } catch (error) {
      throw new IntegrationError('kms', 'Could not unwrap a data key.', { cause: error });
    }
  }

  shred(plaintext: Buffer): void {
    plaintext.fill(0);
  }
}
