/** Session de paiement à ouvrir chez le prestataire pour un hold. */
export interface CheckoutRequest {
  reservationId: number;
  userId: number;
  evenementId: number;
  /** Montant dû, en centimes, calculé par PostgreSQL à partir du prix figé du hold. */
  amountCents: number;
  label: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  expiresAt: Date;
}

export interface CheckoutSession {
  id: string;
  url: string;
}

/** État d'une session relu auprès du prestataire (jamais déduit du corps d'un webhook). */
export interface PaidSession {
  id: string;
  paid: boolean;
  amountTotal: number;
  currency: string;
  reservationId: number | null;
  userId: number | null;
  evenementId: number | null;
}

export interface PaymentGateway {
  createCheckoutSession(request: CheckoutRequest): Promise<CheckoutSession>;
  retrieveSession(sessionId: string): Promise<PaidSession>;
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');
