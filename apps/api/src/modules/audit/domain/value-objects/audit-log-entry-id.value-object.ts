import { createIdType, type Brand } from '@leen-mart/domain-kit';

export type AuditLogEntryId = Brand<string, 'AuditLogEntryId'>;

const auditLogEntryId = createIdType('AuditLogEntryId');

export const isAuditLogEntryId = auditLogEntryId.is;
export const toAuditLogEntryId = auditLogEntryId.from;
