// This module's published interface (SDD 5.1). Other modules must import
// from here, never from `./application/**` or `./infrastructure/**` directly.
//
// SDD 5 classes `media` as platform-wide ("R2 presigning, processing
// pipeline") rather than a numbered domain module — the same standing
// `audit` has, and this barrel is shaped the same way for the same reason:
// the ESLint boundary rules key off the `**/modules/*/{domain,application}/**`
// paths, so living under `modules/` is what makes the published-interface
// rule machine-enforced here too.
//
// No `createMediaModule`: this module has no HTTP surface, no domain model
// and no tables of its own. It publishes one port and one adapter, and
// callers wire the adapter in their own composition root — a direct
// dependency, exactly as `audit` publishes `AmbientAuditWriter`.
//
// Extracted from `vendor` unchanged (Stage 2, S2-0). Everything here was
// built for KYC (SDD 12.1/12.2/12.3) and still carries KYC's names, bucket
// and limits; nothing about its behaviour changed in the move, and the
// public-media bucket SDD 12.1 also describes is deliberately not here yet.
export type {
  ObjectStore,
  PresignPutInput,
  PresignedDownload,
  PresignedUpload,
  StoredObject,
  TemporaryObject,
} from './application/ports/object-store.port.js';
export {
  DOWNLOAD_URL_TTL_SECONDS,
  KYC_ALLOWED_CONTENT_TYPES,
  KYC_MAX_OBJECT_BYTES,
  S3ObjectStore,
  TEMPORARY_DELIVERY_PREFIX,
  UPLOAD_URL_TTL_SECONDS,
  type S3ObjectStoreConfig,
} from './infrastructure/storage/s3-object-store.js';
