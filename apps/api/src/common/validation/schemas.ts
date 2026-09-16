import { z } from 'zod';

/** Identifiant technique : entier strictement positif (bigint PostgreSQL ≤ 2^53). */
export const idSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type Pagination = z.infer<typeof paginationSchema>;

export const slugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'slug invalide');

/** Texte libre borné, espaces de début/fin retirés. */
export const text = (max: number) => z.string().trim().min(1).max(max);

export const moneySchema = z.coerce
  .number()
  .min(0)
  .max(100_000)
  .refine((v) => Math.round(v * 100) === v * 100, 'deux décimales maximum');

export const dateSchema = z.coerce.date();
