import { Injectable } from '@nestjs/common';
import type { AppRole, Tx } from '../../../common/database/db-context.service';
import { offsetOf } from '../../../common/pagination';
import { toNullableNumber, toNumber } from '../../../common/serialization';
import type { Pagination } from '../../../common/validation/schemas';
import type { UserAdminView, UsersRepository } from '../domain/user';

// Colonnes explicites : password_hash n'est lisible par aucun rôle applicatif,
// un SELECT * échouerait (privilèges au niveau colonne).
const SELECT = {
  id: true,
  email: true,
  prenom: true,
  nom: true,
  role_app: true,
  organisateur_id: true,
  created_at: true,
} as const;

type Row = {
  id: bigint;
  email: string;
  prenom: string;
  nom: string;
  role_app: string;
  organisateur_id: bigint | null;
  created_at: Date;
};

const toView = (u: Row): UserAdminView => ({
  id: toNumber(u.id),
  email: u.email,
  prenom: u.prenom,
  nom: u.nom,
  role: u.role_app as AppRole,
  organisateurId: toNullableNumber(u.organisateur_id),
  createdAt: u.created_at,
});

@Injectable()
export class PrismaUsersRepository implements UsersRepository {
  async list(tx: Tx, q: string | undefined, pagination: Pagination) {
    const where = q ? { email: { contains: q, mode: 'insensitive' as const } } : {};
    const [rows, total] = await Promise.all([
      tx.utilisateurs.findMany({
        where,
        select: SELECT,
        orderBy: { id: 'asc' },
        skip: offsetOf(pagination),
        take: pagination.pageSize,
      }),
      tx.utilisateurs.count({ where, select: { _all: true } }),
    ]);
    return { items: rows.map(toView), total: total._all };
  }

  async changeRole(tx: Tx, id: number, role: AppRole, organisateurId: number | null): Promise<number> {
    const result = await tx.utilisateurs.updateMany({
      where: { id: BigInt(id) },
      data: { role_app: role, organisateur_id: organisateurId === null ? null : BigInt(organisateurId) },
    });
    return result.count;
  }

  async findById(tx: Tx, id: number): Promise<UserAdminView | null> {
    const row = await tx.utilisateurs.findFirst({ where: { id: BigInt(id) }, select: SELECT });
    return row ? toView(row) : null;
  }
}
