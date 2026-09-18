import { z } from 'zod';
import { dateSchema, idSchema, paginationSchema, slugSchema, text } from '../../../common/validation/schemas';
import { EVENT_SORTS } from '../domain/event';

const statut = z.enum(['draft', 'published', 'cancelled', 'finished']);

/**
 * public : catalogue tel que le voit un visiteur anonyme (publiés / terminés), même connecté.
 * manage : droits du rôle connecté (organisateur : ses événements, y compris brouillons ; admin : tous).
 */
export const scopeSchema = z.enum(['public', 'manage']).default('public');
export const scopeQuerySchema = z.object({ scope: scopeSchema });
export type Scope = z.infer<typeof scopeSchema>;

export const attributesSchema = z
  .array(
    z.strictObject({
      cle: z.string().trim().regex(/^[a-z][a-z0-9_]{0,49}$/, 'clé en minuscules (a-z, 0-9, _)'),
      valeur: z.string().trim().min(1).max(200),
    }),
  )
  .max(20)
  .refine((a) => new Set(a.map((x) => x.cle)).size === a.length, 'clés en double');

export const listEventsQuerySchema = paginationSchema.extend({
  q: z.string().trim().min(1).max(100).optional(),
  ville: z.string().trim().min(1).max(100).optional(),
  typeId: idSchema.optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  prixMax: z.coerce.number().min(0).max(100_000).optional(),
  statut: statut.optional(),
  sort: z.enum(EVENT_SORTS).default('date'),
  scope: scopeSchema,
});

/** Un identifiant numérique OU un slug (les slugs purement numériques sont refusés à la création). */
export const eventRefSchema = z.union([idSchema.transform((id) => ({ id })), slugSchema.transform((slug) => ({ slug }))]);

const slugNonNumerique = slugSchema.refine((s) => !/^\d+$/.test(s), 'le slug ne peut pas être uniquement numérique');

const eventFields = {
  nom: text(200),
  slug: slugNonNumerique,
  description: z.string().trim().max(5_000),
  debut: dateSchema,
  fin: dateSchema,
  lieuId: idSchema,
  typeEvenementId: idSchema,
};

export const createEventSchema = z
  .strictObject({
    ...eventFields,
    description: eventFields.description.default(''),
    statut: z.enum(['draft', 'published']).default('draft'),
    organisateurId: idSchema.optional(),
  })
  .refine((e) => e.fin > e.debut, { message: 'fin doit être postérieure à debut', path: ['fin'] });

export const updateEventSchema = z
  .strictObject({
    nom: eventFields.nom.optional(),
    slug: eventFields.slug.optional(),
    description: eventFields.description.optional(),
    debut: eventFields.debut.optional(),
    fin: eventFields.fin.optional(),
    lieuId: eventFields.lieuId.optional(),
    typeEvenementId: eventFields.typeEvenementId.optional(),
    statut: statut.optional(),
  })
  .refine((e) => Object.keys(e).length > 0, 'au moins un champ à modifier')
  .refine((e) => !(e.debut && e.fin) || e.fin > e.debut, { message: 'fin doit être postérieure à debut', path: ['fin'] });

export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;
export type CreateEventDto = z.infer<typeof createEventSchema>;
export type UpdateEventDto = z.infer<typeof updateEventSchema>;
