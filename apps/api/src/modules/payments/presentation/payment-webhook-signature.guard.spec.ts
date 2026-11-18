import { createHmac, randomBytes } from 'node:crypto';
import type { AppConfig } from '../../../common/config/config';
import type { ExecutionContext } from '@nestjs/common';
import { PaymentWebhookSignatureGuard, WEBHOOK_TOLERANCE_SECONDS } from './payment-webhook-signature.guard';

// Secret éphémère, différent à chaque exécution.
const secret = `whsec_${randomBytes(24).toString('hex')}`;
const rawBody = Buffer.from('{"id":"evt_1","type":"checkout.session.completed","data":{"object":{"id":"cs_test_1"}}}');

const now = () => Math.floor(Date.now() / 1000);
const sign = (timestamp: number, body: Buffer = rawBody, key = secret) =>
  createHmac('sha256', key).update(`${timestamp}.`).update(body).digest('hex');
const header = (timestamp: number, ...signatures: string[]) =>
  [`t=${timestamp}`, ...signatures.map((s) => `v1=${s}`)].join(',');

function context(signature?: string, body: Buffer | undefined = rawBody): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: signature ? { 'stripe-signature': signature } : {}, rawBody: body }),
    }),
  } as unknown as ExecutionContext;
}

describe('PaymentWebhookSignatureGuard (format Stripe)', () => {
  const guard = new PaymentWebhookSignatureGuard({ STRIPE_WEBHOOK_SECRET: secret } as unknown as AppConfig);

  it('accepte le HMAC-SHA256 de « horodatage.corps » sur les octets exacts', () => {
    const t = now();
    expect(guard.canActivate(context(header(t, sign(t))))).toBe(true);
  });

  it('accepte une signature valide parmi plusieurs (rotation de secret)', () => {
    const t = now();
    expect(guard.canActivate(context(header(t, '0'.repeat(64), sign(t))))).toBe(true);
  });

  it('rejette une signature invalide ou d’un autre secret', () => {
    const t = now();
    expect(() => guard.canActivate(context(header(t, '0'.repeat(64))))).toThrow('Signature webhook invalide');
    expect(() => guard.canActivate(context(header(t, sign(t, rawBody, 'whsec_autre'))))).toThrow(
      'Signature webhook invalide',
    );
  });

  it('rejette une signature calculée sur un autre corps', () => {
    const t = now();
    expect(() => guard.canActivate(context(header(t, sign(t)), Buffer.from('{}')))).toThrow(
      'Signature webhook invalide',
    );
  });

  it('rejette un horodatage modifié (il fait partie du message signé)', () => {
    const t = now();
    expect(() => guard.canActivate(context(header(t - 10, sign(t))))).toThrow('Signature webhook invalide');
  });

  it('rejette le rejeu d’une requête trop ancienne ou datée du futur', () => {
    const old = now() - WEBHOOK_TOLERANCE_SECONDS - 5;
    const future = now() + WEBHOOK_TOLERANCE_SECONDS + 5;
    expect(() => guard.canActivate(context(header(old, sign(old))))).toThrow('Signature webhook invalide');
    expect(() => guard.canActivate(context(header(future, sign(future))))).toThrow('Signature webhook invalide');
  });

  it('rejette un en-tête absent, mal formé ou un corps brut manquant', () => {
    const t = now();
    expect(() => guard.canActivate(context())).toThrow('Signature webhook invalide');
    expect(() => guard.canActivate(context(sign(t)))).toThrow('Signature webhook invalide');
    expect(() => guard.canActivate(context(`t=${t}`))).toThrow('Signature webhook invalide');
    expect(() => guard.canActivate(context(`t=abc,v1=${sign(t)}`))).toThrow('Signature webhook invalide');
    expect(() =>
      guard.canActivate({
        switchToHttp: () => ({ getRequest: () => ({ headers: { 'stripe-signature': header(t, sign(t)) } }) }),
      } as unknown as ExecutionContext),
    ).toThrow('Signature webhook invalide');
  });

  it('répond indisponible sans secret configuré', () => {
    const unconfigured = new PaymentWebhookSignatureGuard({} as AppConfig);
    expect(() => unconfigured.canActivate(context())).toThrow('Webhook de paiement non configuré');
  });
});
