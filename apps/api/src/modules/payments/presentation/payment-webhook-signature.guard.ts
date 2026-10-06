import { createHmac, timingSafeEqual } from 'node:crypto';
import { type CanActivate, type ExecutionContext, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { APP_CONFIG, type AppConfig } from '../../../common/config/config';
import { ApiError } from '../../../common/errors/http-errors';

type RequestWithRawBody = FastifyRequest & { rawBody?: Buffer };

@Injectable()
export class PaymentWebhookSignatureGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithRawBody>();
    const secret = this.config.PAYMENTS_WEBHOOK_SECRET;
    if (!secret) {
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'WEBHOOK_NON_CONFIGURE', 'Webhook de paiement non configuré');
    }

    const signature = request.headers['x-billetto-signature'];
    if (typeof signature !== 'string' || !/^[a-f\d]{64}$/i.test(signature) || !request.rawBody) {
      throw invalidSignature();
    }

    const expected = createHmac('sha256', secret).update(request.rawBody).digest();
    const received = Buffer.from(signature, 'hex');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw invalidSignature();
    return true;
  }
}

const invalidSignature = () =>
  new ApiError(HttpStatus.UNAUTHORIZED, 'SIGNATURE_WEBHOOK_INVALIDE', 'Signature webhook invalide');
