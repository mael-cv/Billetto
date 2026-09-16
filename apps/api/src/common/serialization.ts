import { Prisma } from '@prisma/client';

/** bigint PostgreSQL → number JSON (les identifiants restent < 2^53). */
export function toNumber(value: bigint | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === 'bigint' ? Number(value) : value;
}

export function toNullableNumber(value: bigint | number | null | undefined): number | null {
  return value === null || value === undefined ? null : toNumber(value);
}

/** numeric PostgreSQL → chaîne à 2 décimales (pas d'arrondi flottant sur les montants). */
export function toMoney(value: Prisma.Decimal | number | string | null | undefined): string {
  if (value === null || value === undefined) return '0.00';
  return new Prisma.Decimal(value).toFixed(2);
}

export function toNullableMoney(value: Prisma.Decimal | number | string | null | undefined): string | null {
  return value === null || value === undefined ? null : toMoney(value);
}

/** Échappe %, _ et \ pour un motif ILIKE saisi par l'utilisateur. */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}
