import type { TicketPrice } from '../../events/domain/event';

export type { TicketPrice };

export interface PriceInput {
  nom: string;
  prix: number;
  quota: number;
  dateDebutVente: Date;
  dateFinVente: Date;
  actif: boolean;
}
