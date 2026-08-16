import type { MoneyDto } from '@leen-mart/contracts';

/**
 * `MoneyDto.amount` is an integer number of minor units (paise) as a string
 * (SDD 9.2) — mirrors `customer-pwa`'s own `format-money.ts` exactly.
 */
export const formatMoney = (money: MoneyDto): string => {
  const rupees = Number(money.amount) / 100;
  return `₹${rupees.toFixed(2)}`;
};
