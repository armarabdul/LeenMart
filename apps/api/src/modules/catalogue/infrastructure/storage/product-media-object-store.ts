import { S3Client } from '@aws-sdk/client-s3';
import { PRODUCT_MEDIA_MAX_BYTES, productMediaContentTypeSchema } from '@leen-mart/contracts';
import { S3ObjectStore, type ObjectStore } from '../../../media/index.js';
import type { Env } from '../../../../shared/config/env.js';

/**
 * The `leenmart-public-media` bucket's client (S2-6a, SDD 12.1), built the
 * same way `createKycS3Client` builds `vendor.module.ts`'s: the endpoint and
 * credentials are the entire difference between MinIO locally and R2 in
 * production, and `S3ObjectStore` itself never branches on environment.
 */
const createProductMediaS3Client = (env: Env): S3Client =>
  new S3Client({
    region: env.PRODUCT_MEDIA_S3_REGION,
    endpoint: env.PRODUCT_MEDIA_S3_ENDPOINT,
    forcePathStyle: env.PRODUCT_MEDIA_S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.PRODUCT_MEDIA_S3_ACCESS_KEY_ID,
      secretAccessKey: env.PRODUCT_MEDIA_S3_SECRET_ACCESS_KEY,
    },
  });

/**
 * The allowlist/cap come from the contracts package (D-S2-6-I) — the same
 * values `createProductMediaUploadIntentRequestSchema` validates against on
 * the wire, passed here explicitly rather than duplicated as a second set of
 * literals the way `KYC_ALLOWED_CONTENT_TYPES`/`KYC_MAX_OBJECT_BYTES` are.
 *
 * Lives in its own file rather than inside `catalogue.module.ts` because
 * S2-6b gives it a *second* composition root: the API tier builds one to mint
 * upload URLs and read metadata, and the worker process builds its own to read
 * the original and write the 8 derived objects. One definition, two callers —
 * never two subtly-divergent bucket configurations.
 */
export const buildProductMediaObjectStore = (env: Env): ObjectStore =>
  new S3ObjectStore(createProductMediaS3Client(env), {
    bucket: env.PRODUCT_MEDIA_S3_BUCKET,
    allowedContentTypes: productMediaContentTypeSchema.options,
    maxObjectBytes: PRODUCT_MEDIA_MAX_BYTES,
  });
