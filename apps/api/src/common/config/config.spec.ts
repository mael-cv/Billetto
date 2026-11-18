import { randomBytes } from 'node:crypto';
import { loadConfig } from './config';

// Valeurs éphémères : aucun secret réel dans les tests.
const base = () => ({
  APP_DATABASE_URL: 'postgresql://billetto_app:x@localhost:5433/billetto',
  APP_MONGO_URL: 'mongodb://billetto_app:x@localhost:27017/billetto_nosql',
  JWT_SECRET: randomBytes(32).toString('hex'),
  CORS_ORIGIN: 'http://localhost:3000',
  COOKIE_SECURE: 'false',
});

const stripe = () => ({
  STRIPE_SECRET_KEY: `sk_test_${randomBytes(12).toString('hex')}`,
  STRIPE_WEBHOOK_SECRET: `whsec_${randomBytes(16).toString('hex')}`,
});

describe('configuration', () => {
  it('accepte une configuration de développement sans clés Stripe', () => {
    const config = loadConfig(base());
    expect(config.NODE_ENV).toBe('development');
    expect(config.STRIPE_SECRET_KEY).toBeUndefined();
    expect(config.TRUST_PROXY).toBe(0);
  });

  it('refuse les secrets publics ou par défaut, dans tous les environnements', () => {
    for (const JWT_SECRET of [
      'dev-only-jwt-secret-billetto-0123456789abcdef',
      'change-me-change-me-change-me-change-me',
      'remplacer-par-un-secret-aleatoire-de-32-caracteres',
      'secret-secret-secret-secret-secret-secret',
      'billetto-billetto-billetto-billetto-0000',
    ]) {
      expect(() => loadConfig({ ...base(), JWT_SECRET })).toThrow(/JWT_SECRET/);
      expect(() => loadConfig({ ...base(), JWT_SECRET, NODE_ENV: 'test' })).toThrow(/JWT_SECRET/);
    }
    expect(() => loadConfig({ ...base(), JWT_SECRET: 'trop-court' })).toThrow(/JWT_SECRET/);
  });

  it('exige une URL MongoDB explicite (aucune valeur par défaut contenant un mot de passe)', () => {
    expect(() => loadConfig({ ...base(), APP_MONGO_URL: undefined })).toThrow(/APP_MONGO_URL/);
  });

  it('mode setup par défaut absent : test ; le mode setup n’exige aucune clé Stripe', () => {
    expect(loadConfig(base()).APP_MODE).toBe('test');
    expect(loadConfig({ ...base(), APP_MODE: 'setup' }).APP_MODE).toBe('setup');
    expect(() => loadConfig({ ...base(), APP_MODE: 'autre' })).toThrow(/APP_MODE/);
  });

  it('mode live : clés réelles obligatoires, clé de test refusée', () => {
    const live = {
      ...base(),
      APP_MODE: 'live',
      STRIPE_SECRET_KEY: `sk_live_${'a'.repeat(24)}`,
      STRIPE_WEBHOOK_SECRET: `whsec_${'b'.repeat(32)}`,
    };
    expect(loadConfig(live).APP_MODE).toBe('live');
    expect(() => loadConfig({ ...live, STRIPE_SECRET_KEY: `sk_test_${'a'.repeat(24)}` })).toThrow(/STRIPE_SECRET_KEY/);
    expect(() => loadConfig({ ...live, STRIPE_SECRET_KEY: '' })).toThrow(/STRIPE_SECRET_KEY/);
    expect(() => loadConfig({ ...live, STRIPE_WEBHOOK_SECRET: '' })).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });

  it('mode test : n’accepte que des clés Stripe de test', () => {
    expect(loadConfig({ ...base(), ...stripe() }).STRIPE_SECRET_KEY).toMatch(/^sk_test_/);
    expect(loadConfig({ ...base(), ...stripe(), STRIPE_SECRET_KEY: `rk_test_${'a'.repeat(24)}` }).STRIPE_SECRET_KEY).toMatch(
      /^rk_test_/,
    );
    expect(() => loadConfig({ ...base(), ...stripe(), STRIPE_SECRET_KEY: `sk_live_${'a'.repeat(24)}` })).toThrow(
      /STRIPE_SECRET_KEY/,
    );
    expect(() => loadConfig({ ...base(), ...stripe(), STRIPE_WEBHOOK_SECRET: 'pas-un-secret-stripe' })).toThrow(
      /STRIPE_WEBHOOK_SECRET/,
    );
    // Chaîne vide (variable présente mais non renseignée) : traitée comme absente.
    expect(loadConfig({ ...base(), STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '' }).STRIPE_SECRET_KEY).toBeUndefined();
  });

  it('en production : HTTPS et cookies Secure obligatoires ; Stripe facultatif en mode test', () => {
    const prod = { ...base(), ...stripe(), NODE_ENV: 'production', CORS_ORIGIN: 'https://localhost:3000', COOKIE_SECURE: 'true' };
    expect(loadConfig(prod).NODE_ENV).toBe('production');
    expect(() => loadConfig({ ...prod, COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE/);
    expect(() => loadConfig({ ...prod, CORS_ORIGIN: 'http://localhost:3000' })).toThrow(/HTTPS/);
    // Sans clés de test, l'application démarre : le paiement par carte répond « non configuré ».
    expect(loadConfig({ ...prod, STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '' }).STRIPE_SECRET_KEY).toBeUndefined();
  });

  it('ne révèle jamais la valeur d’un secret dans le message d’erreur', () => {
    const JWT_SECRET = 'dev-only-jwt-secret-billetto-0123456789abcdef';
    try {
      loadConfig({ ...base(), JWT_SECRET });
      throw new Error('une erreur était attendue');
    } catch (err) {
      expect((err as Error).message).not.toContain(JWT_SECRET);
    }
  });
});
