import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

export type AppRole = 'visitor' | 'organizer' | 'admin';

/** Identité PostgreSQL d'une requête. userId null = visiteur anonyme. */
export interface DbActor {
  userId: number | null;
  role: AppRole;
}

export type Tx = Prisma.TransactionClient;

// Liste blanche : le nom de rôle n'est jamais issu d'une entrée utilisateur.
const PG_ROLES: Record<AppRole, string> = {
  visitor: 'billetto_visiteur',
  organizer: 'billetto_organisateur',
  admin: 'billetto_admin',
};

export const ANONYMOUS: DbActor = { userId: null, role: 'visitor' };

/**
 * Exécute un traitement dans une transaction où PostgreSQL connaît l'appelant :
 *   set_config('role', …, true)        ≡ SET LOCAL ROLE (vérifie l'appartenance de billetto_app)
 *   set_config('app.user_id', …, true) contexte lu par les policies RLS
 * Les deux réglages sont locaux à la transaction : une connexion rendue au pool
 * ne conserve ni rôle ni utilisateur.
 */
@Injectable()
export class DbContextService {
  constructor(private readonly prisma: PrismaService) {}

  run<T>(actor: DbActor, work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT set_config('role', ${PG_ROLES[actor.role]}, true),
                 set_config('app.user_id', ${actor.userId === null ? '' : String(actor.userId)}, true)`;
        return work(tx);
      },
      { maxWait: 10_000, timeout: 20_000 },
    );
  }

  /**
   * Données personnelles d'acheteur (commandes, billets, achats) : toujours sous
   * le rôle visiteur, quel que soit le rôle applicatif. Un organisateur ou un
   * admin qui achète un billet est un acheteur comme un autre.
   */
  asBuyer<T>(userId: number, work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.run({ userId, role: 'visitor' }, work);
  }

  /** Requête sans rôle métier (authentification, santé) : droits de billetto_app seuls. */
  raw(): PrismaService {
    return this.prisma;
  }
}
