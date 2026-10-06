import { Injectable } from '@nestjs/common';
import { DbContextService, type AppRole } from '../../common/database/db-context.service';
import { toNullableNumber, toNumber } from '../../common/serialization';
import type { CredentialsRepository, NewAccount, StoredCredentials } from '../domain/credentials.repository';

interface CredentialsRow {
  utilisateur_id: bigint;
  password_hash: string;
  role_app: AppRole;
  organisateur_id: bigint | null;
  prenom: string;
  nom: string;
}

/**
 * Accès aux identifiants via les fonctions SECURITY DEFINER de la migration 005,
 * exécutées avec les seuls droits de billetto_app (aucun rôle métier) :
 * l'API ne lit jamais la table utilisateurs directement pour s'authentifier.
 */
@Injectable()
export class PrismaCredentialsRepository implements CredentialsRepository {
  constructor(private readonly db: DbContextService) {}

  async findByEmail(email: string): Promise<StoredCredentials | null> {
    const rows = await this.db.raw().$queryRaw<CredentialsRow[]>`
      SELECT utilisateur_id, password_hash, role_app, organisateur_id, prenom, nom
      FROM authentification_utilisateur(${email})`;
    const row = rows[0];
    if (!row) return null;
    return {
      userId: toNumber(row.utilisateur_id),
      authVersion: (await this.sessionVersion(toNumber(row.utilisateur_id))) ?? 0,
      passwordHash: row.password_hash,
      role: row.role_app,
      organisateurId: toNullableNumber(row.organisateur_id),
      prenom: row.prenom,
      nom: row.nom,
    };
  }

  async create(account: NewAccount): Promise<number> {
    const rows = await this.db.raw().$queryRaw<{ id: bigint }[]>`
      SELECT inscrire_utilisateur(${account.email}, ${account.passwordHash}, ${account.prenom}, ${account.nom}) AS id`;
    return toNumber(rows[0]?.id);
  }

  async changePassword(userId: number, passwordHash: string): Promise<void> {
    await this.db.run({ userId, role: 'visitor' }, async (tx) => {
      await tx.$queryRaw`SELECT changer_mot_de_passe(${userId}::bigint, ${passwordHash})`;
    });
  }

  async sessionVersion(userId: number): Promise<number | null> {
    const rows = await this.db.raw().$queryRaw<{ version: number | null }[]>`
      SELECT version FROM version_session_utilisateur(${userId}::bigint)`;
    return rows[0]?.version ?? null;
  }
}
