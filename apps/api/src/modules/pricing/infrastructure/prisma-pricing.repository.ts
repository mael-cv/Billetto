import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Tx } from '../../../common/database/db-context.service';
import { toMoney, toNumber } from '../../../common/serialization';
import type { PriceInput, TicketPrice } from '../domain/price';
import type { PricingRepository } from '../domain/pricing.repository';

interface PriceRow {
  id: bigint;
  nom: string;
  prix: Prisma.Decimal;
  quota: number;
  restantes: number;
  date_debut_vente: Date;
  date_fin_vente: Date;
  actif: boolean;
}

const toPrice = (t: PriceRow): TicketPrice => ({
  id: toNumber(t.id),
  nom: t.nom,
  prix: toMoney(t.prix),
  quota: t.quota,
  restantes: t.restantes,
  dateDebutVente: t.date_debut_vente,
  dateFinVente: t.date_fin_vente,
  actif: t.actif,
});

@Injectable()
export class PrismaPricingRepository implements PricingRepository {
  async eventVisible(tx: Tx, eventId: number): Promise<boolean> {
    const rows = await tx.$queryRaw<unknown[]>`SELECT 1 FROM evenements WHERE id = ${eventId}`;
    return rows.length > 0;
  }

  async listForEvent(tx: Tx, eventId: number): Promise<TicketPrice[]> {
    const rows = await tx.$queryRaw<PriceRow[]>`
      SELECT t.id, t.nom, t.prix, t.quota, places_restantes(t.id) AS restantes,
             t.date_debut_vente, t.date_fin_vente, t.actif
      FROM tarifs t
      WHERE t.evenement_id = ${eventId}
      ORDER BY t.prix, t.id`;
    return rows.map(toPrice);
  }

  async findById(tx: Tx, id: number): Promise<TicketPrice | null> {
    const rows = await tx.$queryRaw<PriceRow[]>`
      SELECT t.id, t.nom, t.prix, t.quota, places_restantes(t.id) AS restantes,
             t.date_debut_vente, t.date_fin_vente, t.actif
      FROM tarifs t
      WHERE t.id = ${id}`;
    return rows[0] ? toPrice(rows[0]) : null;
  }

  async create(tx: Tx, eventId: number, input: PriceInput): Promise<number> {
    const created = await tx.tarifs.create({
      data: {
        evenement_id: BigInt(eventId),
        nom: input.nom,
        prix: new Prisma.Decimal(input.prix),
        quota: input.quota,
        date_debut_vente: input.dateDebutVente,
        date_fin_vente: input.dateFinVente,
        actif: input.actif,
      },
      select: { id: true },
    });
    return toNumber(created.id);
  }

  async update(tx: Tx, id: number, input: Partial<PriceInput>): Promise<number> {
    const result = await tx.tarifs.updateMany({
      where: { id: BigInt(id) },
      data: {
        ...(input.nom !== undefined && { nom: input.nom }),
        ...(input.prix !== undefined && { prix: new Prisma.Decimal(input.prix) }),
        ...(input.quota !== undefined && { quota: input.quota }),
        ...(input.dateDebutVente !== undefined && { date_debut_vente: input.dateDebutVente }),
        ...(input.dateFinVente !== undefined && { date_fin_vente: input.dateFinVente }),
        ...(input.actif !== undefined && { actif: input.actif }),
      },
    });
    return result.count;
  }

  async delete(tx: Tx, id: number): Promise<number> {
    const result = await tx.tarifs.deleteMany({ where: { id: BigInt(id) } });
    return result.count;
  }
}
