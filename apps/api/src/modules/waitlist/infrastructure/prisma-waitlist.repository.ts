import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Tx } from '../../../common/database/db-context.service';
import { toMoney, toNumber } from '../../../common/serialization';
import type { ConfirmResult } from '../../orders/domain/order';
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
}

interface ConfirmRow {
  commande_id: bigint;
  paiement_id: bigint;
  billet_ids: bigint[];
  montant_total: Prisma.Decimal;
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

  async confirm(tx: Tx, userId: number, entryId: number): Promise<ConfirmResult> {
    const rows = await tx.$queryRaw<ConfirmRow[]>`
      SELECT commande_id, paiement_id, billet_ids, montant_total
      FROM confirmer_liste_attente(${entryId}::bigint, ${userId}::bigint)`;
    const row = rows[0];
    if (!row) throw new Error('confirmer_liste_attente n’a renvoyé aucune ligne');
    return {
      commandeId: toNumber(row.commande_id),
      paiementId: toNumber(row.paiement_id),
      billetIds: row.billet_ids.map(toNumber),
      montantTotal: toMoney(row.montant_total),
    };
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
      ORDER BY la.created_at, la.id`;
    return rows.map(toQueueItem);
  }

  // Filtre explicite en plus de la RLS : défense en profondeur.
  private entries(tx: Tx, userId: number, entryId: number | null): Promise<EntryRow[]> {
    return tx.$queryRaw<EntryRow[]>`
      SELECT la.id, la.tarif_id, t.nom AS tarif, e.id AS evenement_id, e.nom AS evenement,
             la.quantite_souhaitee, la.statut, position_liste_attente(la.id) AS position,
             la.notifie_a, la.expire_a, la.created_at
      FROM liste_attente la
      JOIN tarifs t     ON t.id = la.tarif_id
      JOIN evenements e ON e.id = t.evenement_id
      WHERE la.utilisateur_id = ${userId}
        AND (${entryId}::bigint IS NULL OR la.id = ${entryId}::bigint)
      ORDER BY la.created_at DESC, la.id DESC`;
  }
}
