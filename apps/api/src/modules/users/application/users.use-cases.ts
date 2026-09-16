import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../../../auth/domain/actor';
import { type AppRole, DbContextService } from '../../../common/database/db-context.service';
import { notFound } from '../../../common/errors/http-errors';
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
  execute(actor: Actor, id: number, role: AppRole, organisateurId: number | null): Promise<UserAdminView> {
    return this.db.run({ userId: actor.userId, role: 'admin' }, async (tx) => {
      if ((await this.users.changeRole(tx, id, role, organisateurId)) === 0) throw notFound('Utilisateur');
      const user = await this.users.findById(tx, id);
      if (!user) throw notFound('Utilisateur');
      return user;
    });
  }
}
