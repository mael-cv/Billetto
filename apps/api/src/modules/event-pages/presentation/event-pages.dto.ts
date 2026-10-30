import { z } from 'zod';
import { dateSchema, text } from '../../../common/validation/schemas';

const programmeItem = z.strictObject({
  heure: dateSchema,
  scene: z.string().trim().max(80).optional(),
  titre: text(120),
  artiste: z.string().trim().max(120).optional(),
  dureeMin: z.coerce.number().int().min(1).max(1440).optional(),
});

const media = z.strictObject({
  type: z.enum(['image', 'video', 'audio']),
  url: z.url().max(500).refine((u) => /^https?:\/\//.test(u), 'URL http(s) attendue'),
  legende: z.string().trim().max(200).optional(),
});

/** Corps de PUT /events/:id/page : la page est remplacée d'un bloc (document embarqué). */
export const eventPageSchema = z.strictObject({
  templateId: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9-]*$/, 'identifiant de template invalide')
    .max(40)
    .default('default'),
  tags: z.array(z.string().trim().min(1).max(30)).max(20).default([]),
  programme: z.array(programmeItem).max(100).default([]),
  medias: z.array(media).max(30).default([]),
  sections: z
    .array(z.strictObject({ title: text(120), icon: z.string().trim().max(40).optional(), content: text(2000) }))
    .max(20)
    .default([]),
  faq: z.array(z.strictObject({ question: text(200), answer: text(2000) })).max(30).default([]),
});

export type EventPageInput = z.infer<typeof eventPageSchema>;
