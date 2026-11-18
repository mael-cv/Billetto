import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../../common/config/config';
import { ApiError } from '../../../common/errors/http-errors';
import type { CheckoutRequest, CheckoutSession, PaidSession, PaymentGateway } from '../domain/payment-gateway';

const STRIPE_API = 'https://api.stripe.com/v1';
// Forme stricte de l'identifiant de session : sert aussi de garde avant de l'insérer dans une URL.
const SESSION_ID = { test: /^cs_test_[A-Za-z0-9]{10,200}$/, live: /^cs_live_[A-Za-z0-9]{10,200}$/ };

interface StripeSession {
  id?: unknown;
  url?: unknown;
  payment_status?: unknown;
  amount_total?: unknown;
  currency?: unknown;
  livemode?: unknown;
  metadata?: Record<string, unknown> | null;
}

const toId = (value: unknown): number | null => {
  const n = typeof value === 'string' && /^\d{1,15}$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

/**
 * Stripe Checkout via l'API HTTP (aucune dépendance tierce). La clé, dont le type
 * (test ou réel) est validé au démarrage selon le mode, n'est jamais journalisée.
 */
@Injectable()
export class StripeGateway implements PaymentGateway {
  private readonly logger = new Logger(StripeGateway.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async createCheckoutSession(request: CheckoutRequest): Promise<CheckoutSession> {
    const body = new URLSearchParams({
      // Moyens de paiement : ceux activés dans le tableau de bord Stripe. Seule une
      // session effectivement payée (payment_status = paid) émet des billets.
      mode: 'payment',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'eur',
      'line_items[0][price_data][unit_amount]': String(request.amountCents),
      'line_items[0][price_data][product_data][name]': request.label.slice(0, 250),
      client_reference_id: String(request.reservationId),
      'metadata[reservationId]': String(request.reservationId),
      'metadata[userId]': String(request.userId),
      'metadata[evenementId]': String(request.evenementId),
      customer_email: request.customerEmail,
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
      expires_at: String(Math.floor(request.expiresAt.getTime() / 1000)),
    });
    const session = await this.call('POST', '/checkout/sessions', body);
    if (typeof session.id !== 'string' || typeof session.url !== 'string') throw unavailable();
    return { id: session.id, url: session.url };
  }

  async retrieveSession(sessionId: string): Promise<PaidSession> {
    // Une session de test n'est jamais acceptée en mode live, et inversement.
    const live = this.config.APP_MODE === 'live';
    if (!(live ? SESSION_ID.live : SESSION_ID.test).test(sessionId)) {
      throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'SESSION_PAIEMENT_INVALIDE', 'Session de paiement invalide');
    }
    const session = await this.call('GET', `/checkout/sessions/${sessionId}`);
    if (session.livemode !== live || session.id !== sessionId) {
      throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'SESSION_PAIEMENT_INVALIDE', 'Session de paiement invalide');
    }
    const metadata = session.metadata ?? {};
    return {
      id: sessionId,
      paid: session.payment_status === 'paid',
      amountTotal: typeof session.amount_total === 'number' ? session.amount_total : -1,
      currency: typeof session.currency === 'string' ? session.currency : '',
      reservationId: toId(metadata.reservationId),
      userId: toId(metadata.userId),
      evenementId: toId(metadata.evenementId),
    };
  }

  private async call(method: 'GET' | 'POST', path: string, body?: URLSearchParams): Promise<StripeSession> {
    const key = this.config.STRIPE_SECRET_KEY;
    if (!key) {
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'PAIEMENT_NON_CONFIGURE', 'Paiement par carte non configuré');
    }
    let response: Response;
    try {
      response = await fetch(`${STRIPE_API}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${key}`,
          ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
        },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      this.logger.error(`Stripe injoignable : ${(err as Error).name}`);
      throw unavailable();
    }
    if (!response.ok) {
      // Le détail renvoyé par Stripe reste côté serveur (il peut citer la requête).
      this.logger.error(`Stripe a répondu ${response.status} sur ${method} ${path.split('/').slice(0, 3).join('/')}`);
      throw unavailable();
    }
    return (await response.json()) as StripeSession;
  }
}

const unavailable = () =>
  new ApiError(HttpStatus.BAD_GATEWAY, 'PAIEMENT_INDISPONIBLE', 'Le service de paiement est momentanément indisponible');
