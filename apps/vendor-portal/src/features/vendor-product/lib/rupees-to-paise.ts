/**
 * Converts what a vendor types (rupees, e.g. `"99.50"`) into `MoneyDto.amount`
 * — an integer number of minor units as a string (SDD 9.2/ADR-0003), which is
 * the only shape `moneySchema` accepts. `null` for anything that is not a
 * plain non-negative decimal, so the caller can show a field error instead of
 * sending a value the server would reject anyway.
 */
export const rupeesToPaise = (rupees: string): string | null => {
  const trimmed = rupees.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const paise = Math.round(Number(trimmed) * 100);
  return Number.isFinite(paise) ? String(paise) : null;
};

/** The inverse, for seeding a price field from a value the server already returned. */
export const paiseToRupees = (paise: string): string => (Number(paise) / 100).toFixed(2);
