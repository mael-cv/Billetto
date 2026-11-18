import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Actor } from '../../../auth/domain/actor';
import { type AppRole, DbContextService } from '../../../common/database/db-context.service';
import { forbidden, notFound } from '../../../common/errors/http-errors';
import { type Page, toPage } from '../../../common/pagination';
import type { Pagination } from '../../../common/validation/schemas';
import { type UserAdminView, USERS_REPOSITORY, type UsersRepository } from '../domain/user';

@Injectable()
export class ListUsersUseCase {
  constructor(
    private readonly db: DbContextService,
    @Inject(USERS_REPOSITORY) private readonly users: UsersRepository,
  ) {}

  async execute(actor: Actor, q: string | undefined, pagination: Pagination): Promise<Page<UserAdminView>> {
    const { items, total } = await this.db.run({ userId: actor.userId, role: 'admin' }, (tx) =>
      this.users.list(tx, q, pagination),
    );
    return toPage(items, total, pagination);
  }
}

@Injectable()
export class ChangeUserRoleUseCase {
  private readonly logger = new Logger(ChangeUserRoleUseCase.name);

  constructor(
    private readonly db: DbContextService,
    @Inject(USERS_REPOSITORY) private readonly users: UsersRepository,
  ) {}

  /**
   * La cohérence rôle / organisateur est garantie par la contrainte
   * ck_utilisateurs_organisateur_coherent (organizer ⇔ organisateur_id non NULL) :
   * une incohérence est refusée par PostgreSQL (422).
   * Le changement prend effet à la prochaine connexion de l'utilisateur.
   */
  async execute(actor: Actor, id: number, role: AppRole, organisateurId: number | null): Promise<UserAdminView> {
    // Un administrateur ne modifie pas son propre rôle (ni promotion détournée,
    // ni rétrogradation accidentelle). Le dernier administrateur est en outre
    // protégé en base (trigger, BT060).
    if (id === actor.userId) throw forbidden('Vous ne pouvez pas modifier votre propre rôle');
    const user = await this.db.run({ userId: actor.userId, role: 'admin' }, async (tx) => {
      if ((await this.users.changeRole(tx, id, role, organisateurId)) === 0) throw notFound('Utilisateur');
      const updated = await this.users.findById(tx, id);
      if (!updated) throw notFound('Utilisateur');
      return updated;
    });
    // Trace d'audit côté serveur (identifiants uniquement, aucune donnée personnelle).
    this.logger.warn(`rôle modifié : utilisateur ${id} → ${role} par l'administrateur ${actor.userId}`);
    return user;
  }
}
