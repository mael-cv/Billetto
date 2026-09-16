import type { Actor } from '../../../auth/domain/actor';
import type { DbActor, DbContextService, Tx } from '../../../common/database/db-context.service';
import type { ApiError } from '../../../common/errors/http-errors';
import type { EventDetail, EventInput } from '../domain/event';
import type { EventsRepository } from '../domain/events.repository';
import { CreateEventUseCase, UpdateEventUseCase } from './events.use-cases';

const input: EventInput = {
  nom: 'Concert',
  slug: 'concert',
  description: '',
  debut: new Date('2027-01-01T20:00:00Z'),
  fin: new Date('2027-01-01T23:00:00Z'),
  lieuId: 1,
  typeEvenementId: 3,
  statut: 'draft',
};

function setup() {
  const runs: DbActor[] = [];
  const db = {
    run: jest.fn(async (actor: DbActor, work: (tx: Tx) => Promise<unknown>) => {
      runs.push(actor);
      return work({} as Tx);
    }),
  } as unknown as DbContextService;
  const repo: jest.Mocked<EventsRepository> = {
    list: jest.fn(),
    findByRef: jest.fn().mockResolvedValue({ id: 10 } as EventDetail),
    create: jest.fn().mockResolvedValue(10),
    update: jest.fn().mockResolvedValue(0),
    delete: jest.fn(),
  };
  return { db, repo, runs };
}

const organizer: Actor = { userId: 2, role: 'organizer', organisateurId: 7, email: 'o@t', prenom: 'O', nom: 'O' };
const admin: Actor = { userId: 1, role: 'admin', organisateurId: null, email: 'a@t', prenom: 'A', nom: 'A' };

const statusOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as ApiError).getStatus();
  }
  return undefined;
};

describe('CreateEventUseCase', () => {
  it('un organisateur crée pour son propre organisateur, sous son rôle PostgreSQL', async () => {
    const { db, repo, runs } = setup();
    await new CreateEventUseCase(db, repo).execute(organizer, input);
    expect(repo.create).toHaveBeenCalledWith(expect.anything(), 7, input);
    expect(runs).toEqual([{ userId: 2, role: 'organizer' }]);
  });

  it('un organisateur ne peut pas viser un autre organisateur', async () => {
    const { db, repo } = setup();
    expect(await statusOf(new CreateEventUseCase(db, repo).execute(organizer, input, 8))).toBe(403);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('un admin doit préciser l’organisateur', async () => {
    const { db, repo } = setup();
    expect(await statusOf(new CreateEventUseCase(db, repo).execute(admin, input))).toBe(400);
    await new CreateEventUseCase(db, repo).execute(admin, input, 8);
    expect(repo.create).toHaveBeenCalledWith(expect.anything(), 8, input);
  });
});

describe('UpdateEventUseCase', () => {
  it('0 ligne modifiée (événement invisible via RLS) → 404', async () => {
    const { db, repo } = setup();
    expect(await statusOf(new UpdateEventUseCase(db, repo).execute(organizer, 99, { nom: 'x' }))).toBe(404);
  });
});
