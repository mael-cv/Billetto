import { createHmac } from 'node:crypto';
import type { AppConfig } from '../../../common/config/config';
import type { ExecutionContext } from '@nestjs/common';
import { PaymentWebhookSignatureGuard } from './payment-webhook-signature.guard';

const secret = 'webhook-secret-for-tests-with-at-least-32-characters';
const rawBody = Buffer.from('{"eventId":"evt-1","type":"payment.succeeded","reservationId":1}');

function context(signature?: string, body: Buffer = rawBody): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: signature ? { 'x-billetto-signature': signature } : {}, rawBody: body }),
    }),
  } as unknown as ExecutionContext;
}

describe('PaymentWebhookSignatureGuard', () => {
  const guard = new PaymentWebhookSignatureGuard({ PAYMENTS_WEBHOOK_SECRET: secret } as AppConfig);

  it('accepte le HMAC-SHA256 des octets exacts du corps', () => {
    const signature = createHmac('sha256', secret).update(rawBody).digest('hex');
    expect(guard.canActivate(context(signature))).toBe(true);
  });

  it('rejette une signature invalide', () => {
    expect(() => guard.canActivate(context('0'.repeat(64)))).toThrow('Signature webhook invalide');
  });

  it('rejette une signature calculée sur un autre corps', () => {
    const signature = createHmac('sha256', secret).update(rawBody).digest('hex');
    expect(() => guard.canActivate(context(signature, Buffer.from('{}')))).toThrow('Signature webhook invalide');
  });

  it('répond indisponible sans secret configuré', () => {
    const unconfigured = new PaymentWebhookSignatureGuard({} as AppConfig);
    expect(() => unconfigured.canActivate(context())).toThrow('Webhook de paiement non configuré');
  });
});
