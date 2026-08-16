import { createIdType, type Brand } from '@leen-mart/domain-kit';

export type LedgerJournalId = Brand<string, 'LedgerJournalId'>;
export type LedgerEntryId = Brand<string, 'LedgerEntryId'>;

const ledgerJournalId = createIdType('LedgerJournalId');
const ledgerEntryId = createIdType('LedgerEntryId');

export const isLedgerJournalId = ledgerJournalId.is;
export const toLedgerJournalId = ledgerJournalId.from;
export const isLedgerEntryId = ledgerEntryId.is;
export const toLedgerEntryId = ledgerEntryId.from;
