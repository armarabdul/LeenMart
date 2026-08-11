import { describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { DecryptCommand, GenerateDataKeyCommand, type KMSClient } from '@aws-sdk/client-kms';
import { DevDataKeyCipher } from '../../../../src/modules/vendor/infrastructure/crypto/dev-data-key-cipher.js';
import { KmsDataKeyCipher } from '../../../../src/modules/vendor/infrastructure/crypto/kms-data-key-cipher.js';

const WRAPPING_KEY = Buffer.from('feedface'.repeat(8), 'hex');
const CONTEXT = { vendorId: 'v-1', documentId: 'd-1' };

const buildDev = (nodeEnv = 'test'): DevDataKeyCipher =>
  new DevDataKeyCipher(WRAPPING_KEY, nodeEnv);

describe('DevDataKeyCipher', () => {
  describe('environment guard', () => {
    it('refuses to construct in production', () => {
      // The second, independent guard: `env.ts` also refuses to select this
      // cipher in production, but neither depends on the other being right.
      expect(() => buildDev('production')).toThrow(/development-only substitute for KMS/);
    });

    it.each(['development', 'test', 'staging'])('constructs in %s', (nodeEnv) => {
      expect(() => buildDev(nodeEnv)).not.toThrow();
    });

    it('rejects a wrapping key that is not 32 bytes', () => {
      expect(() => new DevDataKeyCipher(randomBytes(16), 'test')).toThrow(/exactly 32 bytes/);
    });
  });

  describe('generateDataKey', () => {
    it('returns a 32-byte plaintext key and a wrapped form', async () => {
      const key = await buildDev().generateDataKey();

      expect(key.plaintext).toHaveLength(32);
      expect(key.wrapped.length).toBeGreaterThan(32);
    });

    it('never returns the plaintext inside the wrapped blob', async () => {
      const key = await buildDev().generateDataKey();

      expect(key.wrapped.includes(key.plaintext)).toBe(false);
    });

    it('mints a fresh key every time', async () => {
      const cipher = buildDev();

      const first = await cipher.generateDataKey();
      const second = await cipher.generateDataKey();

      expect(first.plaintext.equals(second.plaintext)).toBe(false);
      expect(first.wrapped.equals(second.wrapped)).toBe(false);
    });
  });

  describe('round trip', () => {
    it('unwraps back to the original plaintext', async () => {
      const cipher = buildDev();
      const key = await cipher.generateDataKey();

      expect((await cipher.unwrap(key.wrapped)).equals(key.plaintext)).toBe(true);
    });

    it('round-trips with an encryption context', async () => {
      const cipher = buildDev();
      const key = await cipher.generateDataKey(CONTEXT);

      expect((await cipher.unwrap(key.wrapped, CONTEXT)).equals(key.plaintext)).toBe(true);
    });

    it('is insensitive to context key ordering', async () => {
      const cipher = buildDev();
      const key = await cipher.generateDataKey({ vendorId: 'v-1', documentId: 'd-1' });

      const unwrapped = await cipher.unwrap(key.wrapped, { documentId: 'd-1', vendorId: 'v-1' });
      expect(unwrapped.equals(key.plaintext)).toBe(true);
    });
  });

  describe('rejection', () => {
    it('rejects a wrapped key bound to a different context', async () => {
      // The property the context exists for: a wrapped key lifted from one
      // row cannot decrypt another object.
      const cipher = buildDev();
      const key = await cipher.generateDataKey(CONTEXT);

      await expect(
        cipher.unwrap(key.wrapped, { vendorId: 'v-2', documentId: 'd-9' }),
      ).rejects.toThrow(/Could not unwrap/);
    });

    it('rejects a wrapped key when the context is omitted entirely', async () => {
      const cipher = buildDev();
      const key = await cipher.generateDataKey(CONTEXT);

      await expect(cipher.unwrap(key.wrapped)).rejects.toThrow(/Could not unwrap/);
    });

    it('rejects a tampered wrapped key', async () => {
      const cipher = buildDev();
      const key = await cipher.generateDataKey();
      const tampered = Buffer.from(key.wrapped);
      const last = tampered.length - 1;
      tampered.writeUInt8(tampered.readUInt8(last) ^ 0xff, last);

      await expect(cipher.unwrap(tampered)).rejects.toThrow(/Could not unwrap/);
    });

    it('rejects a wrapped key from a different wrapping key', async () => {
      const key = await buildDev().generateDataKey();
      const other = new DevDataKeyCipher(randomBytes(32), 'test');

      await expect(other.unwrap(key.wrapped)).rejects.toThrow(/Could not unwrap/);
    });

    it('rejects a blob too short to be a wrapped key', async () => {
      await expect(buildDev().unwrap(Buffer.alloc(4))).rejects.toThrow(/Could not unwrap/);
    });

    it('answers every rejection identically, revealing nothing about the cause', async () => {
      const cipher = buildDev();
      const key = await cipher.generateDataKey(CONTEXT);
      const tampered = Buffer.from(key.wrapped);
      tampered.writeUInt8(tampered.readUInt8(0) ^ 0xff, 0);

      const messages = await Promise.all(
        [
          cipher.unwrap(key.wrapped, { vendorId: 'wrong', documentId: 'wrong' }),
          cipher.unwrap(tampered, CONTEXT),
        ].map((promise) =>
          promise.then(
            () => 'resolved',
            (error: Error) => error.message,
          ),
        ),
      );

      expect(new Set(messages).size).toBe(1);
    });
  });

  describe('shred', () => {
    it('zero-fills the plaintext key in place', async () => {
      const cipher = buildDev();
      const key = await cipher.generateDataKey();
      expect(key.plaintext.some((byte) => byte !== 0)).toBe(true);

      cipher.shred(key.plaintext);

      expect(key.plaintext.every((byte) => byte === 0)).toBe(true);
    });

    it('leaves the wrapped key intact — that copy dies with its database row', async () => {
      const cipher = buildDev();
      const key = await cipher.generateDataKey();
      const before = Buffer.from(key.wrapped);

      cipher.shred(key.plaintext);

      expect(key.wrapped.equals(before)).toBe(true);
    });
  });
});

/** A stand-in KMS client. No credentials, no network — the adapter cannot tell the difference. */
const buildKmsClient = (): { client: KMSClient; send: ReturnType<typeof vi.fn> } => {
  const send = vi.fn();
  return { client: { send } as unknown as KMSClient, send };
};

describe('KmsDataKeyCipher', () => {
  const config = { keyId: 'arn:aws:kms:ap-south-1:000000000000:key/test' };

  it('asks KMS for an AES-256 data key under the configured CMK', async () => {
    const { client, send } = buildKmsClient();
    send.mockResolvedValue({
      Plaintext: new Uint8Array(randomBytes(32)),
      CiphertextBlob: new Uint8Array(randomBytes(64)),
    });

    const key = await new KmsDataKeyCipher(client, config).generateDataKey(CONTEXT);

    const command = send.mock.calls[0]?.[0] as GenerateDataKeyCommand;
    expect(command).toBeInstanceOf(GenerateDataKeyCommand);
    expect(command.input.KeyId).toBe(config.keyId);
    expect(command.input.KeySpec).toBe('AES_256');
    expect(command.input.EncryptionContext).toEqual(CONTEXT);
    expect(key.plaintext).toHaveLength(32);
  });

  it('omits the encryption context when none is supplied', async () => {
    const { client, send } = buildKmsClient();
    send.mockResolvedValue({
      Plaintext: new Uint8Array(randomBytes(32)),
      CiphertextBlob: new Uint8Array(randomBytes(64)),
    });

    await new KmsDataKeyCipher(client, config).generateDataKey();

    expect(
      (send.mock.calls[0]?.[0] as GenerateDataKeyCommand).input.EncryptionContext,
    ).toBeUndefined();
  });

  it('unwraps through KMS Decrypt, passing the same context back', async () => {
    const { client, send } = buildKmsClient();
    const plaintext = randomBytes(32);
    send.mockResolvedValue({ Plaintext: new Uint8Array(plaintext) });
    const wrapped = randomBytes(64);

    const result = await new KmsDataKeyCipher(client, config).unwrap(wrapped, CONTEXT);

    const command = send.mock.calls[0]?.[0] as DecryptCommand;
    expect(command).toBeInstanceOf(DecryptCommand);
    expect(command.input.EncryptionContext).toEqual(CONTEXT);
    expect(result.equals(plaintext)).toBe(true);
  });

  it('surfaces a KMS failure as an integration error, carrying no key material', async () => {
    const { client, send } = buildKmsClient();
    send.mockRejectedValue(new Error('AccessDeniedException: not authorised'));

    const error = await new KmsDataKeyCipher(client, config)
      .generateDataKey()
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ kind: 'INTEGRATION' });
    expect((error as Error).message).toBe('Could not generate a data key.');
  });

  it('rejects a truncated KMS response rather than returning half a key', async () => {
    const { client, send } = buildKmsClient();
    send.mockResolvedValue({ Plaintext: new Uint8Array(randomBytes(32)) });

    await expect(new KmsDataKeyCipher(client, config).generateDataKey()).rejects.toMatchObject({
      kind: 'INTEGRATION',
    });
  });

  it('zero-fills a plaintext key on shred', async () => {
    const { client, send } = buildKmsClient();
    send.mockResolvedValue({
      Plaintext: new Uint8Array(randomBytes(32)),
      CiphertextBlob: new Uint8Array(randomBytes(64)),
    });
    const cipher = new KmsDataKeyCipher(client, config);
    const key = await cipher.generateDataKey();

    cipher.shred(key.plaintext);

    expect(key.plaintext.every((byte) => byte === 0)).toBe(true);
  });
});
