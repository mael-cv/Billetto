import { Injectable } from '@nestjs/common';
import type { Tx } from '../../../common/database/db-context.service';
import { toNullableNumber, toNumber } from '../../../common/serialization';
import type { EventTypeNode, EventTypesRepository } from '../domain/event-type';

interface Row {
  id: bigint;
  parent_id: bigint | null;
  nom: string;
  niveau: number;
  chemin: string;
}

@Injectable()
export class PrismaEventTypesRepository implements EventTypesRepository {
  /** Même requête que database/queries/q8_arbre_types.sql. */
  async tree(tx: Tx): Promise<EventTypeNode[]> {
    const rows = await tx.$queryRaw<Row[]>`
      WITH RECURSIVE arbre AS (
          SELECT t.id, t.parent_id, t.nom, 1 AS niveau, t.nom::text AS chemin, ARRAY[t.id] AS ids
          FROM type_evenements t
          WHERE t.parent_id IS NULL
          UNION ALL
          SELECT enfant.id, enfant.parent_id, enfant.nom, a.niveau + 1,
                 a.chemin || ' > ' || enfant.nom, a.ids || enfant.id
          FROM type_evenements enfant
          JOIN arbre a ON enfant.parent_id = a.id
          WHERE enfant.id <> ALL (a.ids) AND a.niveau < 10
      )
      SELECT id, parent_id, nom, niveau, chemin FROM arbre ORDER BY ids`;
    return rows.map((r) => ({
      id: toNumber(r.id),
      parentId: toNullableNumber(r.parent_id),
      nom: r.nom,
      niveau: r.niveau,
      chemin: r.chemin,
    }));
  }
}
