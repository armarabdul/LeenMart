import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { UuidV7Generator } from '@leen-mart/domain-kit';
import {
  KYC_MAX_OBJECT_BYTES,
  S3ObjectStore,
} from '../../src/modules/vendor/infrastructure/storage/s3-object-store.js';

/**
 * Integration test against the MinIO already in `infra/docker/docker-compose.yml`,
 * which the compose file itself describes as standing in for Cloudflare R2
 * ("R2 is S3-compatible, so the same adapter code works against both").
 *
 * Unit tests can prove a URL is *shaped* correctly; only a real store can prove
 * the conditions baked into it are actually **enforced**. That is what this
 * file is for — every assertion below is about MinIO refusing something, not
 * about what the SDK produced.
 *
 * Never runs against real R2 or real AWS.
 */
describe('S3ObjectStore against MinIO', () => {
  const bucket = 'leenmart-private-kyc-test';
  const idGenerator = new UuidV7Generator();

  const client = new S3Client({
    region: 'auto',
    endpoint: process.env.KYC_S3_ENDPOINT ?? 'http://localhost:9000',
    forcePathStyle: true,
    credentials: { accessKeyId: 'leenmart', secretAccessKey: 'leenmart-dev-secret' },
  });
  const store = new S3ObjectStore(client, { bucket });

  const created: string[] = [];
  const newKey = (): string => {
    const key = `kyc-0-test/${idGenerator.generate()}.enc`;
    created.push(key);
    return key;
  };

  /** Stands in for the browser: the adapter never moves bytes itself (SDD 12.2). */
  const putViaUrl = async (
    url: string,
    body: Buffer,
    headers: Record<string, string>,
  ): Promise<number> => {
    const response = await fetch(url, { method: 'PUT', body, headers });
    return response.status;
  };

  beforeAll(async () => {
    try {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
    } catch {
      // Already there from an earlier run — the only outcome that matters is
      // that the bucket exists.
    }
  });

  afterAll(async () => {
    await Promise.all(created.map((key) => store.delete(key)));
    client.destroy();
  });

  describe('upload', () => {
    it('accepts a PUT that matches the signed content type and length', async () => {
      const key = newKey();
      const body = Buffer.from('pretend-ciphertext');
      const upload = await store.presignPut({
        key,
        contentType: 'application/pdf',
        contentLength: body.byteLength,
      });

      const status = await putViaUrl(upload.url, body, {
        'Content-Type': 'application/pdf',
        'Content-Length': String(body.byteLength),
      });

      expect(status).toBe(200);
    });

    it('MinIO refuses a PUT whose content type differs from the signed one', async () => {
      // The assertion the whole `signableHeaders` decision exists for: without
      // content-type in the signature this upload would have succeeded, and a
      // URL minted for a PDF would have accepted HTML.
      const key = newKey();
      const body = Buffer.from('pretend-ciphertext');
      const upload = await store.presignPut({
        key,
        contentType: 'application/pdf',
        contentLength: body.byteLength,
      });

      const status = await putViaUrl(upload.url, body, {
        'Content-Type': 'text/html',
        'Content-Length': String(body.byteLength),
      });

      expect(status).toBeGreaterThanOrEqual(400);
    });

    it('MinIO refuses a PUT whose body is longer than the signed length', async () => {
      const key = newKey();
      const declared = Buffer.from('short');
      const actual = Buffer.from('very much longer than declared');
      const upload = await store.presignPut({
        key,
        contentType: 'application/pdf',
        contentLength: declared.byteLength,
      });

      const status = await putViaUrl(upload.url, actual, {
        'Content-Type': 'application/pdf',
        'Content-Length': String(actual.byteLength),
      });

      expect(status).toBeGreaterThanOrEqual(400);
    });

    it('refuses to sign an oversized upload at all, so no URL reaches MinIO', async () => {
      await expect(
        store.presignPut({
          key: newKey(),
          contentType: 'application/pdf',
          contentLength: KYC_MAX_OBJECT_BYTES + 1,
        }),
      ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    });
  });

  describe('download', () => {
    it('serves the stored bytes back through a presigned GET', async () => {
      const key = newKey();
      const body = Buffer.from('pretend-ciphertext-for-download');
      const upload = await store.presignPut({
        key,
        contentType: 'image/png',
        contentLength: body.byteLength,
      });
      await putViaUrl(upload.url, body, {
        'Content-Type': 'image/png',
        'Content-Length': String(body.byteLength),
      });

      const download = await store.presignGet(key);
      const response = await fetch(download.url);

      expect(response.status).toBe(200);
      expect(Buffer.from(await response.arrayBuffer()).equals(body)).toBe(true);
    });

    it('signs the download for no more than sixty seconds (SDD 12.1)', async () => {
      const download = await store.presignGet(newKey());

      expect(Number(new URL(download.url).searchParams.get('X-Amz-Expires'))).toBeLessThanOrEqual(
        60,
      );
    });

    it('refuses an unsigned request for the same object — the bucket is not public', async () => {
      const key = newKey();
      const body = Buffer.from('pretend-ciphertext');
      const upload = await store.presignPut({
        key,
        contentType: 'image/png',
        contentLength: body.byteLength,
      });
      await putViaUrl(upload.url, body, {
        'Content-Type': 'image/png',
        'Content-Length': String(body.byteLength),
      });

      const unsigned = new URL(await store.presignGet(key).then((d) => d.url));
      unsigned.search = '';
      const response = await fetch(unsigned.toString());

      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('head and delete', () => {
    it('reports metadata for a stored object', async () => {
      const key = newKey();
      const body = Buffer.from('pretend-ciphertext');
      const upload = await store.presignPut({
        key,
        contentType: 'application/pdf',
        contentLength: body.byteLength,
      });
      await putViaUrl(upload.url, body, {
        'Content-Type': 'application/pdf',
        'Content-Length': String(body.byteLength),
      });

      expect(await store.head(key)).toEqual({
        sizeBytes: body.byteLength,
        contentType: 'application/pdf',
      });
    });

    it('returns null for an object that was never uploaded', async () => {
      expect(await store.head(newKey())).toBeNull();
    });

    it('deletes an object, after which head reports it gone', async () => {
      const key = newKey();
      const body = Buffer.from('pretend-ciphertext');
      const upload = await store.presignPut({
        key,
        contentType: 'application/pdf',
        contentLength: body.byteLength,
      });
      await putViaUrl(upload.url, body, {
        'Content-Type': 'application/pdf',
        'Content-Length': String(body.byteLength),
      });
      expect(await store.head(key)).not.toBeNull();

      await store.delete(key);

      expect(await store.head(key)).toBeNull();
    });

    it('is idempotent when deleting an object that is already gone', async () => {
      await expect(store.delete(newKey())).resolves.toBeUndefined();
    });
  });

  describe('server-side byte capabilities (KYC-7 preparatory)', () => {
    it('reads back the exact bytes a server-side write put there', async () => {
      const written = await store.writeTemporaryObject(
        Buffer.from('server-written plaintext'),
        'application/octet-stream',
      );
      created.push(written.key);

      expect(await store.getObject(written.key)).toEqual(Buffer.from('server-written plaintext'));
    });

    it('preserves arbitrary binary bytes exactly through a write/read round trip', async () => {
      const body = Buffer.from([0x00, 0xff, 0x10, 0x02, 0xfe, 0x7f, 0x80, 0x01]);
      const written = await store.writeTemporaryObject(body, 'application/octet-stream');
      created.push(written.key);

      expect(await store.getObject(written.key)).toEqual(body);
    });

    it('returns null from getObject for a key that was never written', async () => {
      expect(await store.getObject(newKey())).toBeNull();
    });

    it('writes under the dedicated temporary-delivery prefix, never the permanent kyc-0-test prefix', async () => {
      const written = await store.writeTemporaryObject(
        Buffer.from('x'),
        'application/octet-stream',
      );
      created.push(written.key);

      expect(written.key.startsWith('kyc-temp-delivery/')).toBe(true);
    });

    it('never accepts a caller-supplied key — two writes of the same bytes land at different keys', async () => {
      const first = await store.writeTemporaryObject(
        Buffer.from('same'),
        'application/octet-stream',
      );
      const second = await store.writeTemporaryObject(
        Buffer.from('same'),
        'application/octet-stream',
      );
      created.push(first.key, second.key);

      expect(first.key).not.toBe(second.key);
    });

    it('a temporary object is reachable through the existing presignGet, unchanged', async () => {
      const body = Buffer.from('temporary-plaintext-for-delivery');
      const written = await store.writeTemporaryObject(body, 'application/pdf');
      created.push(written.key);

      const download = await store.presignGet(written.key);
      const response = await fetch(download.url);

      expect(response.status).toBe(200);
      expect(Buffer.from(await response.arrayBuffer()).equals(body)).toBe(true);
      // Same 60-second ceiling as every other presignGet call — nothing about
      // the TTL changes for a temporary object.
      expect(Number(new URL(download.url).searchParams.get('X-Amz-Expires'))).toBeLessThanOrEqual(
        60,
      );
    });

    it('the existing delete() removes a temporary object, after which getObject reports it gone', async () => {
      const written = await store.writeTemporaryObject(
        Buffer.from('cleanup me'),
        'application/pdf',
      );

      await store.delete(written.key);

      expect(await store.getObject(written.key)).toBeNull();
    });

    it('getObject reads a permanently-stored object uploaded via the existing presignPut flow, unchanged', async () => {
      const key = newKey();
      const body = Buffer.from('permanent-object-bytes');
      const upload = await store.presignPut({
        key,
        contentType: 'application/pdf',
        contentLength: body.byteLength,
      });
      await putViaUrl(upload.url, body, {
        'Content-Type': 'application/pdf',
        'Content-Length': String(body.byteLength),
      });

      expect(await store.getObject(key)).toEqual(body);
    });
  });
});
