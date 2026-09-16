import { Injectable } from '@nestjs/common';
import type { Tx } from '../../../common/database/db-context.service';
import { offsetOf } from '../../../common/pagination';
import { toNumber } from '../../../common/serialization';
import type { Pagination } from '../../../common/validation/schemas';
import type { Venue, VenuesRepository } from '../domain/venue';

@Injectable()
export class PrismaVenuesRepository implements VenuesRepository {
  async list(tx: Tx, ville: string | undefined, pagination: Pagination) {
    const where = ville ? { ville } : {};
    const [rows, total] = await Promise.all([
      tx.lieux.findMany({
        where,
        select: { id: true, nom: true, adresse: true, ville: true, code_postal: true, capacite: true },
        orderBy: [{ ville: 'asc' }, { nom: 'asc' }],
        skip: offsetOf(pagination),
        take: pagination.pageSize,
      }),
      tx.lieux.count({ where }),
    ]);
    const items: Venue[] = rows.map((l) => ({
      id: toNumber(l.id),
      nom: l.nom,
      adresse: l.adresse,
      ville: l.ville,
      codePostal: l.code_postal,
      capacite: l.capacite,
    }));
    return { items, total };
  }
}
