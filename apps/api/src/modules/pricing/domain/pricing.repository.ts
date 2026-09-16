import type { Tx } from '../../../common/database/db-context.service';
import type { PriceInput, TicketPrice } from './price';

export interface PricingRepository {
  /** L'événement est-il visible pour l'appelant (RLS) ? */
  eventVisible(tx: Tx, eventId: number): Promise<boolean>;
  listForEvent(tx: Tx, eventId: number): Promise<TicketPrice[]>;
  findById(tx: Tx, id: number): Promise<TicketPrice | null>;
  create(tx: Tx, eventId: number, input: PriceInput): Promise<number>;
  update(tx: Tx, id: number, input: Partial<PriceInput>): Promise<number>;
  delete(tx: Tx, id: number): Promise<number>;
}

export const PRICING_REPOSITORY = Symbol('PRICING_REPOSITORY');
