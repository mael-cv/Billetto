import { Injectable } from '@nestjs/common';
import type { Tx } from '../../../common/database/db-context.service';
import { toNullableNumber, toNumber } from '../../../common/serialization';
import type { WaitlistEntry, WaitlistQueueItem, WaitlistRepository, WaitlistStatus } from '../domain/waitlist';

interface QueueRow {
  id: bigint;
  quantite_souhaitee: number;
  statut: WaitlistStatus;
  position: number | null;
  notifie_a: Date | null;
  expire_a: Date | null;
  created_at: Date;
}

interface EntryRow extends QueueRow {
  tarif_id: bigint;
  tarif: string;
  evenement_id: bigint;
  evenement: string;
  reservation_id: bigint | null;
}

const toQueueItem = (r: QueueRow): WaitlistQueueItem => ({
  id: toNumber(r.id),
  quantite: r.quantite_souhaitee,
  statut: r.statut,
  position: r.position,
  notifieA: r.notifie_a,
  expireA: r.expire_a,
  createdAt: r.created_at,
});

const toEntry = (r: EntryRow): WaitlistEntry => ({
  ...toQueueItem(r),
  tarifId: toNumber(r.tarif_id),
  tarif: r.tarif,
  evenementId: toNumber(r.evenement_id),
  evenement: r.evenement,
  reservationId: r.statut === 'notifiee' ? toNullableNumber(r.reservation_id) : null,
});

@Injectable()
export class PrismaWaitlistRepository implements WaitlistRepository {
  async join(tx: Tx, userId: number, tarifId: number, quantite: number): Promise<number> {
    const rows = await tx.$queryRaw<{ id: bigint }[]>`
      SELECT inscrire_liste_attente(${userId}::bigint, ${tarifId}::bigint, ${quantite}::integer) AS id`;
    return toNumber(rows[0]?.id);
  }

  async listForUser(tx: Tx, userId: number): Promise<WaitlistEntry[]> {
    return (await this.entries(tx, userId, null)).map(toEntry);
  }

  async findForUser(tx: Tx, userId: number, entryId: number): Promise<WaitlistEntry | null> {
    const rows = await this.entries(tx, userId, entryId);
    return rows[0] ? toEntry(rows[0]) : null;
  }

  async cancel(tx: Tx, userId: number, entryId: number): Promise<void> {
    await tx.$executeRaw`SELECT annuler_liste_attente(${entryId}::bigint, ${userId}::bigint)`;
  }

  async queueForTarif(tx: Tx, tarifId: number): Promise<WaitlistQueueItem[]> {
    const rows = await tx.$queryRaw<QueueRow[]>`
      SELECT la.id, la.quantite_souhaitee, la.statut, position_liste_attente(la.id) AS position,
             la.notifie_a, la.expire_a, la.created_at
      FROM liste_attente la
      WHERE la.tarif_id = ${tarifId}
      ORDER BY la.created_at, la.id
      LIMIT 500`;
    return rows.map(toQueueItem);
  }

  // Filtre explicite en plus de la RLS : défense en profondeur. Résultat borné :
  // les inscriptions les plus récentes d'abord.
  private entries(tx: Tx, userId: number, entryId: number | null): Promise<EntryRow[]> {
    return tx.$queryRaw<EntryRow[]>`
      SELECT la.id, la.tarif_id, t.nom AS tarif, e.id AS evenement_id, e.nom AS evenement,
             la.quantite_souhaitee, la.statut, position_liste_attente(la.id) AS position,
             la.notifie_a, la.expire_a, la.created_at, la.reservation_id
      FROM liste_attente la
      JOIN tarifs t     ON t.id = la.tarif_id
      JOIN evenements e ON e.id = t.evenement_id
      WHERE la.utilisateur_id = ${userId}
        AND (${entryId}::bigint IS NULL OR la.id = ${entryId}::bigint)
      ORDER BY la.created_at DESC, la.id DESC
      LIMIT 100`;
  }
}
