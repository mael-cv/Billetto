import { purchaseSchema } from '../../modules/tickets/presentation/tickets.controller';
import { createEventSchema, eventRefSchema, listEventsQuerySchema } from '../../modules/events/presentation/events.dto';
import type { ApiError } from '../errors/http-errors';
import { escapeLike } from '../serialization';
import { paginationSchema } from './schemas';
import { ZodPipe } from './zod.pipe';

describe('validation des entrées', () => {
  it('pagination : valeurs par défaut et bornes', () => {
    expect(paginationSchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(paginationSchema.parse({ page: '3', pageSize: '50' })).toEqual({ page: 3, pageSize: 50 });
    expect(paginationSchema.safeParse({ pageSize: '1000' }).success).toBe(false);
    expect(paginationSchema.safeParse({ page: '0' }).success).toBe(false);
  });

  it('achat : quantité bornée et champs inconnus refusés', () => {
    expect(purchaseSchema.parse({ tarifId: '12', quantite: 2 })).toEqual({ tarifId: 12, quantite: 2 });
    expect(purchaseSchema.safeParse({ tarifId: 12, quantite: 11 }).success).toBe(false);
    expect(purchaseSchema.safeParse({ tarifId: -1, quantite: 1 }).success).toBe(false);
    // Affectation de masse : impossible d'imposer utilisateurId ou prix.
    expect(purchaseSchema.safeParse({ tarifId: 12, quantite: 1, utilisateurId: 99 }).success).toBe(false);
  });

  it('tri des événements : liste blanche', () => {
    expect(listEventsQuerySchema.safeParse({ sort: 'prix' }).success).toBe(true);
    expect(listEventsQuerySchema.safeParse({ sort: 'debut; DROP TABLE billets' }).success).toBe(false);
  });

  it('référence d’événement : identifiant ou slug', () => {
    expect(eventRefSchema.parse('42')).toEqual({ id: 42 });
    expect(eventRefSchema.parse('evt-42')).toEqual({ slug: 'evt-42' });
    expect(eventRefSchema.safeParse("x' OR '1'='1").success).toBe(false);
  });

  it('création d’événement : cohérence des dates et slug non numérique', () => {
    const base = { nom: 'Concert', slug: 'concert-test', debut: '2027-01-01T20:00:00Z', lieuId: 1, typeEvenementId: 3 };
    expect(createEventSchema.safeParse({ ...base, fin: '2027-01-01T23:00:00Z' }).success).toBe(true);
    expect(createEventSchema.safeParse({ ...base, fin: '2027-01-01T19:00:00Z' }).success).toBe(false);
    expect(createEventSchema.safeParse({ ...base, slug: '123', fin: '2027-01-01T23:00:00Z' }).success).toBe(false);
  });

  it('ZodPipe : 400 avec le détail des champs', () => {
    const pipe = new ZodPipe(purchaseSchema);
    try {
      pipe.transform({ tarifId: 'abc', quantite: 0 });
      fail('une erreur était attendue');
    } catch (e) {
      const err = e as ApiError;
      expect(err.getStatus()).toBe(400);
      const body = err.getResponse() as { error: string; details: { champ: string }[] };
      expect(body.error).toBe('VALIDATION');
      expect(body.details.map((d) => d.champ).sort()).toEqual(['quantite', 'tarifId']);
    }
  });

  it('escapeLike neutralise les jokers ILIKE', () => {
    expect(escapeLike('100%_off\\')).toBe('100\\%\\_off\\\\');
  });
});
