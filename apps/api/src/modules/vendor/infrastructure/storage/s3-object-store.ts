import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { IntegrationError, ValidationError } from '@leen-mart/domain-kit';
import type {
  ObjectStore,
  PresignPutInput,
  PresignedDownload,
  PresignedUpload,
  StoredObject,
} from '../../application/ports/object-store.port.js';

/**
 * SDD 12.2 requires an allowlist and a size cap but states neither value;
 * both were settled as project decisions and are fixed here rather than
 * configured, because a deployment that could widen them could defeat them.
 */
export const KYC_ALLOWED_CONTENT_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'application/pdf',
];

/** 10 MB. */
export const KYC_MAX_OBJECT_BYTES = 10 * 1024 * 1024;

/** SDD 12.2's presigned PUT window. */
export const UPLOAD_URL_TTL_SECONDS = 5 * 60;

/** SDD 12.1: "Presigned GET ≤ 60 s". A ceiling, not a default. */
export const DOWNLOAD_URL_TTL_SECONDS = 60;

export interface S3ObjectStoreConfig {
  readonly bucket: string;
}

/**
 * One adapter for both environments.
 *
 * Cloudflare R2 speaks the S3 API (SDD 4: "S3-compatible API, so the adapter
 * is portable"), and MinIO stands in for it locally — so this class is the
 * whole of the difference between development and production, and that
 * difference is entirely in the injected `S3Client`'s endpoint and
 * credentials. There is deliberately no branch on environment anywhere in
 * here: a code path that only runs in production is a code path that is never
 * tested.
 *
 * The client is injected rather than constructed so tests can drive a real
 * MinIO or a stub without this class knowing which.
 */
export class S3ObjectStore implements ObjectStore {
  constructor(
    private readonly client: S3Client,
    private readonly config: S3ObjectStoreConfig,
  ) {}

  async presignPut(input: PresignPutInput): Promise<PresignedUpload> {
    // Validated before signing, never after: an issued URL is a capability,
    // and there is no taking one back.
    if (!KYC_ALLOWED_CONTENT_TYPES.includes(input.contentType)) {
      throw new ValidationError('This file type is not accepted.', {
        code: 'UNSUPPORTED_CONTENT_TYPE',
        details: [
          {
            field: 'contentType',
            issue: `Must be one of: ${KYC_ALLOWED_CONTENT_TYPES.join(', ')}`,
          },
        ],
      });
    }
    if (!Number.isInteger(input.contentLength) || input.contentLength <= 0) {
      throw new ValidationError('A file size must be a positive whole number of bytes.', {
        code: 'INVALID_CONTENT_LENGTH',
        details: [{ field: 'contentLength', issue: 'Must be a positive integer.' }],
      });
    }
    if (input.contentLength > KYC_MAX_OBJECT_BYTES) {
      throw new ValidationError('This file is too large.', {
        code: 'FILE_TOO_LARGE',
        details: [
          { field: 'contentLength', issue: `Must not exceed ${KYC_MAX_OBJECT_BYTES} bytes.` },
        ],
      });
    }

    // `ContentType` and `ContentLength` are part of the signed request, so a
    // client that sends anything else is refused by the store itself. Passing
    // them is what turns the checks above from advice into enforcement.
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.contentLength,
    });

    // `signableHeaders` is not optional here. Left to its defaults the
    // presigner signs `content-length` but *hoists* `content-type` out of the
    // signature, which would leave the declared type advisory — a client could
    // then upload an HTML document under a URL minted for a PDF. Naming both
    // explicitly is what makes SDD 12.2's "declared type in allowlist" hold at
    // the store rather than only in this process.
    const url = await this.sign(command, UPLOAD_URL_TTL_SECONDS, 'presign an upload URL', {
      signableHeaders: new Set(['content-type', 'content-length']),
    });

    return {
      url,
      expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000),
      contentType: input.contentType,
      contentLength: input.contentLength,
    };
  }

  async presignGet(key: string): Promise<PresignedDownload> {
    // No TTL parameter, by design — see the port's note. SDD 12.1's 60-second
    // ceiling is not something a caller can be trusted to re-state correctly
    // at every call site.
    const command = new GetObjectCommand({ Bucket: this.config.bucket, Key: key });
    const url = await this.sign(command, DOWNLOAD_URL_TTL_SECONDS, 'presign a download URL');

    return { url, expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000) };
  }

  async head(key: string): Promise<StoredObject | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      return {
        sizeBytes: result.ContentLength ?? 0,
        contentType: result.ContentType ?? 'application/octet-stream',
      };
    } catch (error) {
      // A missing object is an answer, not a failure — `null` lets the
      // upload-completion check say "not there yet" without a thrown error.
      if (isNotFound(error)) return null;
      throw new IntegrationError('object-storage', 'Could not read object metadata.', {
        cause: error,
      });
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
    } catch (error) {
      if (isNotFound(error)) return;
      throw new IntegrationError('object-storage', 'Could not delete object.', { cause: error });
    }
  }

  /** Wraps every signing call so a store outage surfaces as an integration failure, never as a leaked SDK error. */
  private async sign(
    command: PutObjectCommand | GetObjectCommand,
    expiresIn: number,
    what: string,
    options: { signableHeaders?: Set<string> } = {},
  ): Promise<string> {
    try {
      return await getSignedUrl(this.client, command, { expiresIn, ...options });
    } catch (error) {
      throw new IntegrationError('object-storage', `Could not ${what}.`, { cause: error });
    }
  }
}

/** S3 answers a missing key with 404, or `NoSuchKey`/`NotFound` depending on the operation. */
const isNotFound = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  if (candidate.$metadata?.httpStatusCode === 404) return true;
  return candidate.name === 'NotFound' || candidate.name === 'NoSuchKey';
};
