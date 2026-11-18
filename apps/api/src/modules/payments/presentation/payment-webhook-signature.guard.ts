import { createHmac, timingSafeEqual } from 'node:crypto';
import { type CanActivate, type ExecutionContext, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { APP_CONFIG, type AppConfig } from '../../../common/config/config';
import { ApiError } from '../../../common/errors/http-errors';

type RequestWithRawBody = FastifyRequest & { rawBody?: Buffer };

/** Écart maximal entre l'horodatage signé et l'heure du serveur (rejeu d'une requête capturée). */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

/**
 * Signature Stripe : en-tête « Stripe-Signature: t=<unix>,v1=<hex>[,v1=<hex>] »,
 * où v1 = HMAC-SHA256(secret, "<t>.<corps brut>"). Le corps est celui reçu,
 * octet pour octet, avant tout parsing.
 */
@Injectable()
export class PaymentWebhookSignatureGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithRawBody>();
    const secret = this.config.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'WEBHOOK_NON_CONFIGURE', 'Webhook de paiement non configuré');
    }

    const header = request.headers['stripe-signature'];
    if (typeof header !== 'string' || header.length > 1024 || !request.rawBody) throw invalidSignature();

    let timestamp: string | undefined;
    const candidates: string[] = [];
    for (const part of header.split(',')) {
      const separator = part.indexOf('=');
      const key = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      if (key === 't' && /^\d{1,12}$/.test(value)) timestamp = value;
      if (key === 'v1' && /^[a-f\d]{64}$/i.test(value)) candidates.push(value);
    }
    if (!timestamp || candidates.length === 0) throw invalidSignature();

    const age = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (age > WEBHOOK_TOLERANCE_SECONDS) throw invalidSignature();

    const expected = createHmac('sha256', secret)
      .update(Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), request.rawBody]))
      .digest();
    // Toutes les signatures candidates sont comparées (pas de sortie anticipée).
    let valid = false;
    for (const candidate of candidates) {
      const received = Buffer.from(candidate, 'hex');
      if (received.length === expected.length && timingSafeEqual(received, expected)) valid = true;
    }
    if (!valid) throw invalidSignature();
    return true;
  }
}

const invalidSignature = () =>
  new ApiError(HttpStatus.UNAUTHORIZED, 'SIGNATURE_WEBHOOK_INVALIDE', 'Signature webhook invalide');
