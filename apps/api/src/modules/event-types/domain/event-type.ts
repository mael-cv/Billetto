import type { Tx } from '../../../common/database/db-context.service';

export interface EventTypeNode {
  id: number;
  parentId: number | null;
  nom: string;
  niveau: number;
  chemin: string;
}

export interface EventTypesRepository {
  tree(tx: Tx): Promise<EventTypeNode[]>;
}

export const EVENT_TYPES_REPOSITORY = Symbol('EVENT_TYPES_REPOSITORY');
