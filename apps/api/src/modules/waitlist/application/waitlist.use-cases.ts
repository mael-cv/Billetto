import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../../../auth/domain/actor';
import { DbContextService } from '../../../common/database/db-context.service';
import { notFound } from '../../../common/errors/http-errors';
import type { ConfirmResult } from '../../orders/domain/order';
import {
  WAITLIST_REPOSITORY,
  type WaitlistEntry,
  type WaitlistQueueItem,
  type WaitlistRepository,
} from '../domain/waitlist';

// Aucune règle métier ici : FIFO, quota et offres sont dans les fonctions SQL
// de 010_liste_attente.sql.

@Injectable()
export class JoinWaitlistUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(WAITLIST_REPOSITORY) private readonly waitlist: WaitlistRepository,
  ) {}

  execute(actor: Actor, tarifId: number, quantite: number): Promise<WaitlistEntry> {
    return this.db.asBuyer(actor.userId, async (tx) => {
      const id = await this.waitlist.join(tx, actor.userId, tarifId, quantite);
      const entry = await this.waitlist.findForUser(tx, actor.userId, id);
      if (!entry) throw notFound('Inscription');
      return entry;
    });
  }
}

@Injectable()
export class ListMyWaitlistUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(WAITLIST_REPOSITORY) private readonly waitlist: WaitlistRepository,
  ) {}

  execute(actor: Actor): Promise<WaitlistEntry[]> {
    return this.db.asBuyer(actor.userId, (tx) => this.waitlist.listForUser(tx, actor.userId));
  }
}

@Injectable()
export class ConfirmWaitlistUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(WAITLIST_REPOSITORY) private readonly waitlist: WaitlistRepository,
  ) {}

  /** Accepte l'offre (confirmer_liste_attente → confirmer_reservation). */
  execute(actor: Actor, entryId: number): Promise<ConfirmResult> {
    return this.db.asBuyer(actor.userId, (tx) => this.waitlist.confirm(tx, actor.userId, entryId));
  }
}

@Injectable()
export class CancelWaitlistUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(WAITLIST_REPOSITORY) private readonly waitlist: WaitlistRepository,
  ) {}

  /** Désinscription ; une offre en cours passe au suivant (trigger SQL). */
  execute(actor: Actor, entryId: number): Promise<void> {
    return this.db.asBuyer(actor.userId, (tx) => this.waitlist.cancel(tx, actor.userId, entryId));
  }
}

@Injectable()
export class TarifWaitlistUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(WAITLIST_REPOSITORY) private readonly waitlist: WaitlistRepository,
  ) {}

  /** Organisateur : la RLS limite aux tarifs de ses événements (liste vide sinon). */
  execute(actor: Actor, tarifId: number): Promise<WaitlistQueueItem[]> {
    return this.db.run({ userId: actor.userId, role: actor.role }, (tx) => this.waitlist.queueForTarif(tx, tarifId));
  }
}
