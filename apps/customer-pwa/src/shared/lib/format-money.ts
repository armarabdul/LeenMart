import type { MoneyDto } from '@leen-mart/contracts';

/**
 * `MoneyDto.amount` is an integer number of minor units (paise) as a string
 * (SDD 9.2) — never a float on the wire. `currency` is a zod `z.literal('INR')`
 * in every contract that uses `moneySchema`, so a hardcoded ₹ is not an
 * assumption this UI is making on its own; it is the one value the schema
 * itself permits.
 */
export const formatMoney = (money: MoneyDto): string => {
  const rupees = Number(money.amount) / 100;
  return `₹${rupees.toFixed(2)}`;
};
