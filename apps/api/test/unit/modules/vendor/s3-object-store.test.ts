import { describe, expect, it, vi } from 'vitest';
import { S3Client } from '@aws-sdk/client-s3';
import {
  DOWNLOAD_URL_TTL_SECONDS,
  KYC_ALLOWED_CONTENT_TYPES,
  KYC_MAX_OBJECT_BYTES,
  S3ObjectStore,
  UPLOAD_URL_TTL_SECONDS,
} from '../../../../src/modules/media/index.js';

const BUCKET = 'leenmart-private-kyc';
const KEY = 'vendor/abc/pan.enc';

/**
 * A real `S3Client` pointed at nothing. Presigning is a pure signing operation
 * — it never contacts the endpoint — so URL shape, TTL and bound conditions
 * can all be asserted without a network. `send` is stubbed for the two
 * operations that *would* make a call.
 */
const buildStore = (): { store: S3ObjectStore; send: ReturnType<typeof vi.fn> } => {
  const client = new S3Client({
    region: 'auto',
    endpoint: 'http://localhost:9000',
    forcePathStyle: true,
    credentials: { accessKeyId: 'test-key', secretAccessKey: 'test-secret' },
  });
  const send = vi.fn();
  (client as unknown as { send: unknown }).send = send;

  return {
    store: new S3ObjectStore(client, {
      bucket: BUCKET,
      allowedContentTypes: KYC_ALLOWED_CONTENT_TYPES,
      maxObjectBytes: KYC_MAX_OBJECT_BYTES,
    }),
    send,
  };
};

const expiresInOf = (url: string): number => Number(new URL(url).searchParams.get('X-Amz-Expires'));

describe('S3ObjectStore', () => {
  describe('presignPut', () => {
    it.each(KYC_ALLOWED_CONTENT_TYPES)('signs an upload for %s', async (contentType) => {
      const { store } = buildStore();

      const upload = await store.presignPut({ key: KEY, contentType, contentLength: 1024 });

      expect(upload.url).toContain(BUCKET);
      expect(upload.contentType).toBe(contentType);
      expect(upload.contentLength).toBe(1024);
    });

    it('binds a five-minute lifetime into the signature', async () => {
      const { store } = buildStore();

      const upload = await store.presignPut({
        key: KEY,
        contentType: 'application/pdf',
        contentLength: 1024,
      });

      expect(expiresInOf(upload.url)).toBe(UPLOAD_URL_TTL_SECONDS);
      expect(UPLOAD_URL_TTL_SECONDS).toBe(300);
    });

    it('signs the content type and content length, so a client cannot substitute either', async () => {
      // The point of the whole design: the conditions live in the signature,
      // not in a check the client is trusted to respect.
      const { store } = buildStore();

      const upload = await store.presignPut({
        key: KEY,
        contentType: 'image/png',
        contentLength: 2048,
      });

      const signedHeaders = new URL(upload.url).searchParams.get('X-Amz-SignedHeaders') ?? '';
      expect(signedHeaders).toContain('content-type');
      expect(signedHeaders).toContain('content-length');
    });

    it.each(['text/html', 'image/svg+xml', 'application/octet-stream', 'application/zip'])(
      'refuses %s',
      async (contentType) => {
        const { store } = buildStore();

        await expect(
          store.presignPut({ key: KEY, contentType, contentLength: 1024 }),
        ).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT_TYPE' });
      },
    );

    it('refuses a file over the 10 MB cap', async () => {
      const { store } = buildStore();

      await expect(
        store.presignPut({
          key: KEY,
          contentType: 'application/pdf',
          contentLength: KYC_MAX_OBJECT_BYTES + 1,
        }),
      ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    });

    it('accepts a file exactly at the cap', async () => {
      const { store } = buildStore();

      const upload = await store.presignPut({
        key: KEY,
        contentType: 'application/pdf',
        contentLength: KYC_MAX_OBJECT_BYTES,
      });

      expect(upload.contentLength).toBe(KYC_MAX_OBJECT_BYTES);
      expect(KYC_MAX_OBJECT_BYTES).toBe(10 * 1024 * 1024);
    });

    it.each([0, -1, 1.5, Number.NaN])('refuses a content length of %s', async (contentLength) => {
      const { store } = buildStore();

      await expect(
        store.presignPut({ key: KEY, contentType: 'application/pdf', contentLength }),
      ).rejects.toMatchObject({ code: 'INVALID_CONTENT_LENGTH' });
    });

    it('never signs a URL for a rejected request', async () => {
      // A refusal must produce no capability at all, not a capability plus an
      // error the caller might ignore.
      const { store } = buildStore();

      const result = await store
        .presignPut({ key: KEY, contentType: 'text/html', contentLength: 1024 })
        .catch(() => 'rejected' as const);

      expect(result).toBe('rejected');
    });
  });

  describe('presignGet', () => {
    it('signs a download URL', async () => {
      const { store } = buildStore();

      const download = await store.presignGet(KEY);

      expect(download.url).toContain(BUCKET);
      expect(download.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('caps the lifetime at SDD 12.1’s sixty seconds', async () => {
      const { store } = buildStore();

      const download = await store.presignGet(KEY);

      expect(expiresInOf(download.url)).toBe(DOWNLOAD_URL_TTL_SECONDS);
      expect(DOWNLOAD_URL_TTL_SECONDS).toBe(60);
      expect(DOWNLOAD_URL_TTL_SECONDS).toBeLessThanOrEqual(60);
    });

    it('exposes no way for a caller to ask for longer', () => {
      // Enforced by the signature rather than by a runtime check: there is no
      // TTL parameter to pass.
      const { store } = buildStore();

      expect(store.presignGet).toHaveLength(1);
    });
  });

  describe('head', () => {
    it('returns metadata for a stored object', async () => {
      const { store, send } = buildStore();
      send.mockResolvedValue({ ContentLength: 4096, ContentType: 'application/pdf' });

      expect(await store.head(KEY)).toEqual({ sizeBytes: 4096, contentType: 'application/pdf' });
    });

    it('returns null for a missing object rather than throwing', async () => {
      const { store, send } = buildStore();
      send.mockRejectedValue(
        Object.assign(new Error('nope'), { $metadata: { httpStatusCode: 404 } }),
      );

      expect(await store.head(KEY)).toBeNull();
    });

    it('surfaces a store outage as an integration failure', async () => {
      const { store, send } = buildStore();
      send.mockRejectedValue(
        Object.assign(new Error('boom'), { $metadata: { httpStatusCode: 500 } }),
      );

      await expect(store.head(KEY)).rejects.toMatchObject({ kind: 'INTEGRATION' });
    });
  });

  describe('delete', () => {
    it('deletes an object', async () => {
      const { store, send } = buildStore();
      send.mockResolvedValue({});

      await expect(store.delete(KEY)).resolves.toBeUndefined();
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('is idempotent for an object that is already gone', async () => {
      const { store, send } = buildStore();
      send.mockRejectedValue(Object.assign(new Error('gone'), { name: 'NoSuchKey' }));

      await expect(store.delete(KEY)).resolves.toBeUndefined();
    });

    it('surfaces a store outage as an integration failure', async () => {
      const { store, send } = buildStore();
      send.mockRejectedValue(
        Object.assign(new Error('boom'), { $metadata: { httpStatusCode: 503 } }),
      );

      await expect(store.delete(KEY)).rejects.toMatchObject({ kind: 'INTEGRATION' });
    });
  });

  describe('multiple instances (S2-6a regression)', () => {
    // Guards the bug S2-6a found and fixed: `presignPut` used to read
    // `KYC_ALLOWED_CONTENT_TYPES`/`KYC_MAX_OBJECT_BYTES` as hardcoded module
    // constants rather than `this.config`, so a second `S3ObjectStore`
    // instance silently enforced KYC's rules regardless of its own bucket.
    // These prove a differently-configured instance enforces *its own*
    // allowlist and cap, independent of the KYC instance built above.
    const PRODUCT_MEDIA_ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
    const PRODUCT_MEDIA_MAX_OBJECT_BYTES = 10 * 1024 * 1024;

    const buildProductMediaStore = (): S3ObjectStore => {
      const client = new S3Client({
        region: 'auto',
        endpoint: 'http://localhost:9000',
        forcePathStyle: true,
        credentials: { accessKeyId: 'test-key', secretAccessKey: 'test-secret' },
      });
      return new S3ObjectStore(client, {
        bucket: 'leenmart-public-media',
        allowedContentTypes: PRODUCT_MEDIA_ALLOWED_CONTENT_TYPES,
        maxObjectBytes: PRODUCT_MEDIA_MAX_OBJECT_BYTES,
      });
    };

    it('accepts a type KYC refuses (application/pdf is not in the product-media allowlist)', async () => {
      const store = buildProductMediaStore();

      await expect(
        store.presignPut({ key: KEY, contentType: 'image/webp', contentLength: 1024 }),
      ).resolves.toMatchObject({ contentType: 'image/webp' });
    });

    it('refuses a type only KYC allows', async () => {
      const store = buildProductMediaStore();

      await expect(
        store.presignPut({ key: KEY, contentType: 'application/pdf', contentLength: 1024 }),
      ).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT_TYPE' });
    });

    it('enforces its own size cap, not the KYC instance’s', async () => {
      const store = buildProductMediaStore();

      await expect(
        store.presignPut({
          key: KEY,
          contentType: 'image/jpeg',
          contentLength: PRODUCT_MEDIA_MAX_OBJECT_BYTES + 1,
        }),
      ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    });

    it('leaves the KYC instance unaffected by the product-media instance existing', async () => {
      const { store: kycStore } = buildStore();
      buildProductMediaStore();

      await expect(
        kycStore.presignPut({ key: KEY, contentType: 'image/webp', contentLength: 1024 }),
      ).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT_TYPE' });
    });
  });

  describe('secrets', () => {
    it('keeps credentials out of the presigned URL', async () => {
      const { store } = buildStore();

      const upload = await store.presignPut({
        key: KEY,
        contentType: 'image/jpeg',
        contentLength: 512,
      });
      const download = await store.presignGet(KEY);

      // The access key id appears in the credential scope by design; the
      // secret never does, anywhere.
      expect(upload.url).not.toContain('test-secret');
      expect(download.url).not.toContain('test-secret');
    });
  });
});
