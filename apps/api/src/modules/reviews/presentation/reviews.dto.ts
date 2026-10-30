import { z } from 'zod';
import { paginationSchema, text } from '../../../common/validation/schemas';

export const noteSchema = z.coerce.number().int().min(1).max(5);

export const createReviewSchema = z.strictObject({
  note: noteSchema,
  titre: z.string().trim().max(120).optional(),
  commentaire: text(2000),
});
export type CreateReviewDto = z.infer<typeof createReviewSchema>;

export const updateReviewSchema = createReviewSchema.partial().refine((v) => Object.keys(v).length > 0, 'aucun champ');
export type UpdateReviewDto = z.infer<typeof updateReviewSchema>;

export const replySchema = z.strictObject({ texte: text(2000) });

export const listReviewsQuerySchema = paginationSchema.extend({
  noteMin: noteSchema.optional(),
  sansReponse: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type ListReviewsQuery = z.infer<typeof listReviewsQuerySchema>;

/** ObjectId MongoDB : 24 caractères hexadécimaux. */
export const objectIdSchema = z.string().regex(/^[0-9a-f]{24}$/, 'identifiant invalide');
