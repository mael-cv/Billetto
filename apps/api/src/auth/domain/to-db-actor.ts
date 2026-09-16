import { ANONYMOUS, type DbActor } from '../../common/database/db-context.service';
import type { Actor } from './actor';

/** Identité PostgreSQL correspondant à l'utilisateur HTTP (anonyme = visiteur sans contexte). */
export const toDbActor = (actor: Actor | null): DbActor =>
  actor ? { userId: actor.userId, role: actor.role } : ANONYMOUS;
