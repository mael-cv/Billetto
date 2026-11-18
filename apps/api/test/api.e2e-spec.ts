import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaService } from '../src/common/database/prisma.service';
import { MongoService } from '../src/common/mongodb/mongo.service';
import { cleanFixtures, createFixtures, email, type Fixtures } from './fixtures';
import {
  buy,
  Client,
  deliverWebhook,
  type FakeGateway,
  installFakeGateway,
  owner,
  payHold,
  RUN,
  sessionIdOf,
  startApp,
  stripeSignature,
  TEST_PASSWORD,
  testConfig,
} from './support';

/**
 * Tests de bout en bout sur la vraie base PostgreSQL (migrations 001–006 + seed).
 * L'API se connecte en billetto_app : chaque vérification d'accès ci-dessous est
 * appliquée par PostgreSQL (GRANT, RLS, fonctions), pas seulement par l'API.
 */
describe('API Billetto (e2e)', () => {
  let app: NestFastifyApplication;
  let gateway: FakeGateway;
  let fx: Fixtures;
  let anonyme: Client;
  let visiteur: Client;
  let visiteur2: Client;
  let orgaA: Client;
  let orgaB: Client;
  let admin: Client;

  beforeAll(async () => {
    fx = await createFixtures();
    app = await startApp(testConfig());
    // Aucun appel à Stripe pendant les tests : la passerelle est remplacée par un double.
    gateway = installFakeGateway(app);
    anonyme = await Client.anonymous(app);
    visiteur = await Client.login(app, fx.userVisiteur, TEST_PASSWORD);
    orgaA = await Client.login(app, fx.userOrgaA, TEST_PASSWORD);
    orgaB = await Client.login(app, fx.userOrgaB, TEST_PASSWORD);
    admin = await Client.login(app, fx.userAdmin, TEST_PASSWORD);
  });

  afterAll(async () => {
    await app?.close();
    await cleanFixtures();
    await owner.$disconnect();
  });

  // ---------------------------------------------------------------------------
  describe('connexion base de données', () => {
    it('l’API est connectée en billetto_app, jamais en propriétaire', async () => {
      const prisma = app.get(PrismaService);
      const [row] = await prisma.$queryRaw<{ session_user: string; super: boolean }[]>`
        SELECT session_user, (SELECT rolsuper FROM pg_roles WHERE rolname = session_user) AS super`;
      expect(row).toEqual({ session_user: 'billetto_app', super: false });
    });

    it('GET /health', async () => {
      const res = await anonyme.get('/health');
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok', database: 'up', mongodb: 'up' });
    });
  });

  // ---------------------------------------------------------------------------
  describe('sécurité HTTP', () => {
    it('en-têtes de sécurité (helmet)', async () => {
      const res = await anonyme.get('/health');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toBe("default-src 'none';frame-ancestors 'none'");
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['strict-transport-security']).toBeDefined();
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['permissions-policy']).toContain('camera=()');
    });

    it('CORS : seule l’origine du front est autorisée', async () => {
      const ok = await anonyme.request('OPTIONS', '/events', undefined, {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'POST',
      });
      expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
      expect(ok.headers['access-control-allow-credentials']).toBe('true');

      const evil = await anonyme.request('OPTIONS', '/events', undefined, {
        origin: 'https://evil.example',
        'access-control-request-method': 'POST',
      });
      expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('requête modifiante sans jeton CSRF → 403', async () => {
      const res = await visiteur.post(
        '/orders/hold',
        { tarifId: fx.tarifQuota5, quantite: 1, modePaiement: 'carte' },
        { 'x-csrf-token': '' },
      );
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe('CSRF_INVALIDE');
    });

    it('requête modifiante depuis une origine étrangère (jeton valide) → 403', async () => {
      const res = await visiteur.post(
        '/orders/hold',
        { tarifId: fx.tarifQuota5, quantite: 1, modePaiement: 'carte' },
        { origin: 'https://evil.example' },
      );
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe('CSRF_INVALIDE');
    });

    it('corps trop volumineux → 413', async () => {
      const res = await anonyme.post('/auth/login', { email: 'a@b.fr', password: 'x'.repeat(100_000) });
      expect(res.statusCode).toBe(413);
    });

    it('JSON invalide → 400 sans détail interne', async () => {
      const res = await anonyme.post('/auth/login', '{"email": ', { 'content-type': 'application/json' });
      expect(res.statusCode).toBe(400);
      expect(res.body).not.toMatch(/at \w+ \(|node_modules|stack/i);
    });

    it('validation : 400 avec détail des champs, champs inconnus refusés', async () => {
      const res = await visiteur.post('/orders/hold', { tarifId: 'abc', quantite: 0, modePaiement: 'carte', prix: 0 });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'VALIDATION', message: 'Requête invalide' });
      expect(res.json().details.length).toBeGreaterThanOrEqual(2);
    });

    it('anciennes routes de paiement « gratuit » supprimées → 404', async () => {
      // Plus aucun moyen pour un acheteur de créer lui-même une commande payée.
      expect((await visiteur.post('/tickets/purchase', { tarifId: fx.tarifQuota5, quantite: 1 })).statusCode).toBe(404);
      expect((await visiteur.post('/orders/1/confirm')).statusCode).toBe(404);
      expect((await visiteur.post('/waitlist/1/confirm')).statusCode).toBe(404);
    });

    it('limite de débit : le compteur strict vise la route résolue, pas l’URL brute', async () => {
      const limited = await startApp(testConfig({ RATE_LIMIT_AUTH_MAX: '2' }));
      try {
        const client = await Client.anonymous(limited);
        const body = { email: 'x@billetto.test', password: 'y' };
        // Chemin encodé (%6c = « l ») : s'il atteint la connexion, il vise le même compteur.
        const statuses = [
          (await client.post('/auth/login', body)).statusCode,
          (await client.post('/auth/%6cogin', body)).statusCode,
          (await client.post('/auth/%6Cogin', body)).statusCode,
          (await client.post('/auth/login', body)).statusCode,
          (await client.post('/auth/%6cogin', body)).statusCode,
        ];
        // 401 = la tentative a atteint la vérification du mot de passe : jamais plus que la limite.
        expect(statuses.filter((s) => s === 401).length).toBeLessThanOrEqual(2);
        expect(statuses).toContain(429);
      } finally {
        await limited.close();
      }
    });

    it('limite de débit : X-Forwarded-For ignoré sans proxy de confiance', async () => {
      const limited = await startApp(testConfig({ RATE_LIMIT_AUTH_MAX: '2', TRUST_PROXY: '0' }));
      try {
        const client = await Client.anonymous(limited);
        const body = { email: 'x@billetto.test', password: 'y' };
        const statuses: number[] = [];
        for (let i = 0; i < 3; i++) {
          statuses.push((await client.post('/auth/login', body, { 'x-forwarded-for': `203.0.113.${i + 1}` })).statusCode);
        }
        // Changer l'en-tête à chaque requête ne donne pas un nouveau compteur.
        expect(statuses).toEqual([401, 401, 429]);
      } finally {
        await limited.close();
      }
    });

    it('paramètres : identifiant, tri et taille de page contrôlés', async () => {
      expect((await visiteur.get('/orders/abc')).statusCode).toBe(400);
      expect((await anonyme.get('/events?sort=debut;DROP TABLE billets')).statusCode).toBe(400);
      expect((await anonyme.get('/events?pageSize=1000')).statusCode).toBe(400);
    });

    it('injection SQL dans la recherche : traitée comme du texte', async () => {
      const res = await anonyme.get(`/events?q=${encodeURIComponent("' OR 1=1 --")}`);
      expect(res.statusCode).toBe(200);
      expect(res.json().total).toBe(0);
      const joker = await anonyme.get(`/events?q=${encodeURIComponent('%')}`);
      expect(joker.json().total).toBe(0);
    });

    it('route inconnue → 404 au format standard', async () => {
      const res = await anonyme.get('/nexiste-pas');
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ statusCode: 404 });
    });
  });

  // ---------------------------------------------------------------------------
  describe('webhook de paiement', () => {
    let tarifWebhook: number;
    const ticketsOf = async (reservationId: number) => {
      const [row] = await owner.$queryRaw<{ n: bigint; statut: string }[]>`
        SELECT (SELECT count(*) FROM billets b WHERE b.commande_id = r.commande_id) AS n, r.statut
        FROM reservations r WHERE r.id = ${reservationId}`;
      return { billets: Number(row?.n), statut: row?.statut };
    };
    const newHold = async (quantite = 1) => {
      const hold = await visiteur.post('/orders/hold', { tarifId: tarifWebhook, quantite, modePaiement: 'carte' });
      expect(hold.statusCode).toBe(201);
      const checkout = await visiteur.post(`/orders/holds/${hold.json().id}/checkout`);
      expect(checkout.statusCode).toBe(200);
      expect(checkout.json()).toMatchObject({ statut: 'paiement', url: expect.stringMatching(/^https:\/\/checkout\.stripe\.com\//) });
      return { reservationId: hold.json().id as number, sessionId: sessionIdOf(checkout.json().url) };
    };

    beforeAll(async () => {
      const [tarif] = await owner.$queryRaw<{ id: bigint }[]>`
        INSERT INTO tarifs (evenement_id, nom, prix, quota, date_debut_vente, date_fin_vente)
        VALUES (${fx.eventFutur}, ${`Webhook ${RUN}`}, 25, 50, now() - interval '1 day', now() + interval '29 days')
        RETURNING id`;
      tarifWebhook = Number(tarif?.id);
    });

    it('le montant envoyé au prestataire vient du serveur (prix figé du hold), jamais du client', async () => {
      const { reservationId } = await newHold(2);
      const request = gateway.requests.find((r) => r.reservationId === reservationId);
      expect(request).toMatchObject({ amountCents: 5000, evenementId: fx.eventFutur });
      expect(request?.successUrl).toBe(`http://localhost:3000/#/checkout/success?reservation=${reservationId}`);
      // Aucun champ du client n'est accepté par la route de paiement.
      expect((await visiteur.post(`/orders/holds/${reservationId}/checkout`, { amountCents: 1 })).statusCode).toBe(200);
      expect(gateway.requests.filter((r) => r.reservationId === reservationId).every((r) => r.amountCents === 5000)).toBe(true);
    });

    it('signature absente, fausse, d’un autre secret ou trop ancienne → 401, rien n’est émis', async () => {
      const { reservationId, sessionId } = await newHold();
      gateway.pay(sessionId);
      const body = JSON.stringify({ id: 'evt_e2e_forge', type: 'checkout.session.completed', data: { object: { id: sessionId } } });
      const old = Math.floor(Date.now() / 1000) - 3600;
      for (const signature of [
        `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`,
        stripeSignature(body, 'whsec_un_autre_secret_que_celui_du_serveur'),
        stripeSignature(body, undefined, old),
        'n-importe-quoi',
      ]) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/payments/webhook',
          payload: body,
          headers: { 'content-type': 'application/json', 'stripe-signature': signature },
        });
        expect(res.statusCode).toBe(401);
        expect(res.json()).toMatchObject({ error: 'SIGNATURE_WEBHOOK_INVALIDE' });
      }
      const sans = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/webhook',
        payload: body,
        headers: { 'content-type': 'application/json' },
      });
      expect(sans.statusCode).toBe(401);
      expect(await ticketsOf(reservationId)).toEqual({ billets: 0, statut: 'active' });
    });

    it('webhook correctement signé mais session NON payée chez le prestataire → aucun billet', async () => {
      // Connaître le secret de signature ne suffit pas : l'état du paiement est relu auprès du prestataire.
      const { reservationId, sessionId } = await newHold();
      const res = await deliverWebhook(app, sessionId);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ received: true, resultat: 'ignore' });
      expect(await ticketsOf(reservationId)).toEqual({ billets: 0, statut: 'active' });

      // Session inventée : refusée, rien n'est émis.
      const inconnue = await deliverWebhook(app, 'cs_test_sessioninventeeparlattaquant');
      expect(inconnue.statusCode).toBe(422);
      // Autre type d'événement : ignoré.
      const autre = await deliverWebhook(app, sessionId, { type: 'payment_intent.created' });
      expect(autre.json()).toEqual({ received: true, resultat: 'ignore' });
    });

    it('montant encaissé différent du prix du hold → 409, aucun billet, événement non journalisé', async () => {
      const { reservationId, sessionId } = await newHold();
      gateway.pay(sessionId, { amountTotal: 1 });
      const res = await deliverWebhook(app, sessionId, { eventId: `evt_e2e_montant_${RUN}` });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('MONTANT_INCOHERENT');
      expect(await ticketsOf(reservationId)).toEqual({ billets: 0, statut: 'active' });
      const [{ n }] = await owner.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM paiement_webhooks WHERE evenement_externe_id = ${`evt_e2e_montant_${RUN}`}`;
      expect(Number(n)).toBe(0);
    });

    it('paiement confirmé : billets émis une seule fois, rejeu idempotent', async () => {
      const { reservationId, sessionId } = await newHold();
      gateway.pay(sessionId);
      const eventId = `evt_e2e_ok_${RUN}`;
      const first = await deliverWebhook(app, sessionId, { eventId });
      const replay = await deliverWebhook(app, sessionId, { eventId });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toEqual({ received: true, resultat: 'traite' });
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toEqual({ received: true, resultat: 'doublon' });
      expect(await ticketsOf(reservationId)).toEqual({ billets: 1, statut: 'confirmee' });

      // Un second événement pour la même session ne crée pas une seconde commande.
      const autreEvenement = await deliverWebhook(app, sessionId, { eventId: `evt_e2e_bis_${RUN}` });
      expect(autreEvenement.statusCode).toBe(409);
      expect(await ticketsOf(reservationId)).toEqual({ billets: 1, statut: 'confirmee' });

      const [{ n }] = await owner.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM paiement_webhooks WHERE reservation_id = ${reservationId}`;
      expect(Number(n)).toBe(1);

      const hold = (await visiteur.get(`/orders/holds/${reservationId}`)).json();
      expect(hold).toMatchObject({ statut: 'confirmee', commandeId: expect.any(Number) });
    });

    it('réservations : celles d’un autre → 404 (lecture, paiement, annulation) ; annulation par son auteur', async () => {
      const { reservationId } = await newHold();
      const intrus = await Client.login(app, fx.userOrgaB, TEST_PASSWORD);
      expect((await intrus.get(`/orders/holds/${reservationId}`)).statusCode).toBe(404);
      expect((await intrus.post(`/orders/holds/${reservationId}/checkout`)).statusCode).toBe(404);
      expect((await intrus.delete(`/orders/holds/${reservationId}`)).statusCode).toBe(404);
      expect((await anonyme.post(`/orders/holds/${reservationId}/checkout`)).statusCode).toBe(401);

      expect((await visiteur.get('/orders/holds/me')).json().map((h: { id: number }) => h.id)).toContain(reservationId);
      expect((await visiteur.delete(`/orders/holds/${reservationId}`)).statusCode).toBe(204);
      expect((await visiteur.get(`/orders/holds/${reservationId}`)).json().statut).toBe('annulee');
      const again = await visiteur.post(`/orders/holds/${reservationId}/checkout`);
      expect(again.statusCode).toBe(409);
      expect(again.json().error).toBe('RESERVATION_NON_ACTIVE');
    });

    it('plafond : un compte ne peut pas immobiliser plus de 10 places d’un tarif sans payer', async () => {
      const plafond = await Client.anonymous(app);
      await plafond.post('/auth/register', { email: email('plafond'), password: TEST_PASSWORD, prenom: 'P', nom: 'Lafond' });
      await plafond.post('/auth/login', { email: email('plafond'), password: TEST_PASSWORD });
      const hold = (quantite: number) => plafond.post('/orders/hold', { tarifId: tarifWebhook, quantite, modePaiement: 'virement' });
      expect((await hold(10)).statusCode).toBe(201);
      const refus = await hold(1);
      expect(refus.statusCode).toBe(409);
      expect(refus.json().error).toBe('PLAFOND_RESERVATIONS');
      // Un virement n'immobilise plus les places que 24 h.
      const [mine] = (await plafond.get('/orders/holds/me')).json();
      expect(new Date(mine.expireA).getTime() - Date.now()).toBeLessThanOrEqual(24 * 3_600_000);
    });

    it('virement : l’acheteur ne peut pas se valider ; seul l’organisateur de l’événement (ou un admin) le peut', async () => {
      const hold = await visiteur.post('/orders/hold', { tarifId: tarifWebhook, quantite: 1, modePaiement: 'virement' });
      const id: number = hold.json().id;

      expect((await visiteur.post(`/orders/holds/${id}/validate-transfer`)).statusCode).toBe(403);
      expect((await visiteur.get('/orders/holds/transfers')).statusCode).toBe(403);
      // Un virement ne se règle pas par carte.
      expect((await visiteur.post(`/orders/holds/${id}/checkout`)).json().error).toBe('MODE_PAIEMENT_INVALIDE');
      // L'organisateur d'un autre collectif ne voit pas la réservation.
      expect((await orgaB.post(`/orders/holds/${id}/validate-transfer`)).statusCode).toBe(404);
      expect((await orgaB.get('/orders/holds/transfers')).json().map((t: { id: number }) => t.id)).not.toContain(id);

      const attendus = (await orgaA.get('/orders/holds/transfers')).json();
      expect(attendus.find((t: { id: number }) => t.id === id)).toMatchObject({ quantite: 1, montantTotal: '25.00' });
      expect(JSON.stringify(attendus)).not.toMatch(/email|utilisateurId/);

      const ok = await orgaA.post(`/orders/holds/${id}/validate-transfer`);
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({ commandeId: expect.any(Number), billetIds: [expect.any(Number)] });
      expect((await visiteur.get(`/orders/${ok.json().commandeId}`)).json()).toMatchObject({ statut: 'paid', nbBillets: 1 });
      expect((await orgaA.post(`/orders/holds/${id}/validate-transfer`)).statusCode).toBe(409);
    });
  });

  // ---------------------------------------------------------------------------
  describe('authentification', () => {
    it('inscription : aucune session ouverte ; connexion ensuite, cookie HttpOnly + SameSite=Strict, rôle visitor imposé', async () => {
      const client = await Client.anonymous(app);
      const res = await client.post('/auth/register', {
        email: email('inscrit'),
        password: TEST_PASSWORD,
        prenom: 'Nouveau',
        nom: 'Compte',
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({ message: expect.any(String) });
      expect(res.cookies.find((c) => c.name === 'billetto_session')).toBeUndefined();
      expect((await client.get('/auth/me')).statusCode).toBe(401);

      const login = await client.post('/auth/login', { email: email('inscrit'), password: TEST_PASSWORD });
      expect(login.statusCode).toBe(200);
      expect(login.json().user).toMatchObject({ role: 'visitor', email: email('inscrit') });
      const session = login.cookies.find((c) => c.name === 'billetto_session');
      expect(session).toMatchObject({ httpOnly: true, sameSite: 'Strict', secure: true });
      expect((await client.get('/auth/me')).statusCode).toBe(200);
    });

    it('inscription : rôle non modifiable, mot de passe faible refusé', async () => {
      const client = await Client.anonymous(app);
      const escalade = await client.post('/auth/register', {
        email: email('escalade'),
        password: TEST_PASSWORD,
        prenom: 'X',
        nom: 'Y',
        role: 'admin',
      });
      expect(escalade.statusCode).toBe(400);
      for (const password of ['court', 'aaaaaaaaaaaaaaaa', 'password1234', 'azertyuiop123']) {
        expect((await client.post('/auth/register', { email: email('faible'), password, prenom: 'X', nom: 'Y' })).statusCode).toBe(400);
      }
    });

    it('inscription : même réponse pour une adresse libre et une adresse déjà utilisée (pas d’énumération)', async () => {
      const client = await Client.anonymous(app);
      const body = { password: TEST_PASSWORD, prenom: 'X', nom: 'Y' };
      const libre = await client.post('/auth/register', { ...body, email: email('libre') });
      const prise = await client.post('/auth/register', { ...body, password: `Autre-${TEST_PASSWORD}`, email: fx.userVisiteur });
      expect(prise.statusCode).toBe(libre.statusCode);
      expect(prise.json()).toEqual(libre.json());
      expect(prise.cookies.map((c) => c.name)).toEqual(libre.cookies.map((c) => c.name));
      // Le compte existant n'a pas été modifié : son mot de passe d'origine fonctionne toujours.
      expect((await client.post('/auth/login', { email: fx.userVisiteur, password: `Autre-${TEST_PASSWORD}` })).statusCode).toBe(401);
      expect((await Client.login(app, fx.userVisiteur, TEST_PASSWORD)).csrf).not.toBe('');
    });

    it('verrouillage : 10 échecs consécutifs bloquent le compte, même avec le bon mot de passe', async () => {
      const client = await Client.anonymous(app);
      const compte = email('verrou');
      await client.post('/auth/register', { email: compte, password: TEST_PASSWORD, prenom: 'V', nom: 'Errou' });
      for (let i = 0; i < 10; i++) {
        expect((await client.post('/auth/login', { email: compte, password: 'mauvais-mot-de-passe' })).statusCode).toBe(401);
      }
      const bloque = await client.post('/auth/login', { email: compte, password: TEST_PASSWORD });
      expect(bloque.statusCode).toBe(401);
      // Même message que pour un mot de passe faux : le verrouillage ne révèle rien.
      expect(bloque.json().message).toBe('Identifiants invalides');

      await owner.$executeRaw`UPDATE utilisateurs SET verrouille_jusqu_a = now() - interval '1 second' WHERE email = ${compte}`;
      expect((await client.post('/auth/login', { email: compte, password: TEST_PASSWORD })).statusCode).toBe(200);
    });

    it('changement de mot de passe : le nouveau doit différer de l’actuel', async () => {
      const client = await Client.login(app, email('inscrit'), TEST_PASSWORD);
      const res = await client.post('/auth/password', { currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD });
      expect(res.statusCode).toBe(400);
    });

    it('connexion : même réponse pour mauvais mot de passe et compte inconnu', async () => {
      const client = await Client.anonymous(app);
      const faux = await client.post('/auth/login', { email: fx.userVisiteur, password: 'mauvais' });
      const inconnu = await client.post('/auth/login', { email: 'inconnu@billetto.test', password: 'mauvais' });
      expect(faux.statusCode).toBe(401);
      expect(inconnu.statusCode).toBe(401);
      expect(faux.json().message).toBe(inconnu.json().message);
    });

    it('les comptes du seed sans hash valide ne peuvent pas se connecter', async () => {
      const client = await Client.anonymous(app);
      // security-audit-ignore: generic-secret -- mot de passe invalide attendu en échec (401)
      expect((await client.post('/auth/login', { email: 'user1@billetto.test', password: '!seed-no-login' })).statusCode).toBe(401);
    });

    it('session absente, falsifiée ou fermée → 401', async () => {
      expect((await anonyme.get('/auth/me')).statusCode).toBe(401);

      const faux = await Client.anonymous(app);
      faux.setCookie('billetto_session', 'eyJhbGciOiJub25lIn0.eyJzdWIiOjEsInJvbGUiOiJhZG1pbiJ9.');
      expect((await faux.get('/auth/me')).statusCode).toBe(401);

      // Compte dédié : la déconnexion révoque toutes les sessions du compte.
      const client = await Client.login(app, email('inscrit'), TEST_PASSWORD);
      expect((await client.post('/auth/logout')).statusCode).toBe(204);
      expect((await client.get('/auth/me')).statusCode).toBe(401);
    });

    it('déconnexion : le jeton est révoqué côté serveur (une copie du cookie ne vaut plus rien)', async () => {
      const client = await Client.login(app, email('inscrit'), TEST_PASSWORD);
      const login = await client.post('/auth/login', { email: email('inscrit'), password: TEST_PASSWORD });
      const token = login.cookies.find((c) => c.name === 'billetto_session')?.value ?? '';
      expect(token).not.toBe('');
      expect((await client.post('/auth/logout')).statusCode).toBe(204);

      const voleur = await Client.anonymous(app);
      voleur.setCookie('billetto_session', token);
      expect((await voleur.get('/auth/me')).statusCode).toBe(401);
    });

    it('limitation de débit sur la connexion → 429', async () => {
      const limited = await startApp(testConfig({ RATE_LIMIT_AUTH_MAX: '3' }));
      try {
        const client = await Client.anonymous(limited);
        const statuses: number[] = [];
        for (let i = 0; i < 5; i++) {
          statuses.push((await client.post('/auth/login', { email: 'x@billetto.test', password: 'y' })).statusCode);
        }
        expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
        expect(statuses[3]).toBe(429);
      } finally {
        await limited.close();
      }
    });
  });

  // ---------------------------------------------------------------------------
  describe('catalogue public', () => {
    it('liste paginée : uniquement des événements publiés ou terminés', async () => {
      const res = await anonyme.get('/events?pageSize=100');
      expect(res.statusCode).toBe(200);
      const page = res.json();
      expect(page).toMatchObject({ page: 1, pageSize: 100 });
      expect(page.total).toBeGreaterThan(0);
      expect(page.items.every((e: { statut: string }) => ['published', 'finished'].includes(e.statut))).toBe(true);
    });

    it('brouillon d’un organisateur : invisible (404) pour un visiteur, par id comme par slug', async () => {
      expect((await anonyme.get(`/events/${fx.eventDraftB}`)).statusCode).toBe(404);
      expect((await visiteur.get(`/events/${fx.eventDraftBSlug}`)).statusCode).toBe(404);
      expect((await anonyme.get(`/events?statut=draft`)).json().total).toBe(0);
    });

    it('détail : lieu, tarifs et places restantes', async () => {
      const res = await anonyme.get(`/events/${fx.eventFutur}`);
      expect(res.statusCode).toBe(200);
      const tarif = res.json().tarifs.find((t: { id: number }) => t.id === fx.tarifQuota5);
      expect(tarif).toMatchObject({ prix: '25.00', quota: 5, restantes: 5 });
    });

    it('arbre des types (WITH RECURSIVE) et filtre incluant les sous-types', async () => {
      const tree = (await anonyme.get('/event-types/tree')).json();
      expect(tree).toHaveLength(18);
      expect(tree).toContainEqual(expect.objectContaining({ nom: 'Rock', niveau: 3, chemin: 'Musique > Concert > Rock' }));

      const musique = tree.find((t: { nom: string }) => t.nom === 'Musique');
      const res = await anonyme.get(`/events?typeId=${musique.id}&q=${encodeURIComponent('E2E e2e-futur')}`);
      expect(res.json().items.map((e: { id: number }) => e.id)).toContain(fx.eventFutur);
    });

    it('villes distinctes', async () => {
      const villes = (await anonyme.get('/venues/cities')).json();
      expect(villes).toEqual(expect.arrayContaining(['Lyon', 'Paris']));
      expect(new Set(villes).size).toBe(villes.length);
    });

    it('lieux paginés', async () => {
      const res = await anonyme.get('/venues?pageSize=5');
      expect(res.statusCode).toBe(200);
      expect(res.json().items).toHaveLength(5);
    });
  });

  // ---------------------------------------------------------------------------
  describe('achat, commandes, remboursement', () => {
    let commande: number;

    it('réservation anonyme → 401', async () => {
      const res = await anonyme.post('/orders/hold', { tarifId: fx.tarifQuota5, quantite: 1, modePaiement: 'carte' });
      expect(res.statusCode).toBe(401);
    });

    it('achat payé (réservation, paiement, webhook) → visible dans billets et commandes', async () => {
      const achat = await buy(app, gateway, visiteur, fx.tarifQuota5, 2);
      expect(achat.billetIds).toHaveLength(2);
      commande = achat.commandeId;

      const detail = (await visiteur.get(`/orders/${commande}`)).json();
      expect(detail).toMatchObject({ id: commande, statut: 'paid', montantTotal: '50.00', nbBillets: 2 });
      expect(detail.billets[0]).toMatchObject({ evenementId: fx.eventFutur, tarif: 'Quota 5', prixPaye: '25.00' });

      const tickets = (await visiteur.get('/tickets/me?pageSize=100')).json();
      expect(tickets.items.filter((t: { commandeId: number }) => t.commandeId === commande)).toHaveLength(2);

      const orders = (await visiteur.get('/orders/me')).json();
      expect(orders.items.map((o: { id: number }) => o.id)).toContain(commande);

      const payments = (await visiteur.get(`/orders/${commande}/payments`)).json();
      expect(payments).toEqual([expect.objectContaining({ type: 'charge', montant: '50.00', statut: 'succeeded' })]);

      expect((await anonyme.get(`/events/${fx.eventFutur}`)).json().tarifs.find((t: { id: number }) => t.id === fx.tarifQuota5).restantes).toBe(3);
    });

    it('quota épuisé → 409 QUOTA_EPUISE (règle appliquée par creer_reservation)', async () => {
      const res = await visiteur.post('/orders/hold', { tarifId: fx.tarifQuota5, quantite: 4, modePaiement: 'carte' });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'QUOTA_EPUISE' });
      expect(res.json().message).toMatch(/3 restant/);
    });

    it('événement commencé → 409, tarif inexistant → 404', async () => {
      const commence = await visiteur.post('/orders/hold', { tarifId: fx.tarifCommence, quantite: 1, modePaiement: 'carte' });
      expect(commence.statusCode).toBe(409);
      expect(commence.json().error).toBe('EVENEMENT_COMMENCE');

      const inexistant = await visiteur.post('/orders/hold', { tarifId: 999_999_999, quantite: 1, modePaiement: 'carte' });
      expect(inexistant.statusCode).toBe(404);
      expect(inexistant.json().error).toBe('TARIF_INTROUVABLE');
    });

    it('commande d’un autre utilisateur : 404 en lecture, paiements et remboursement', async () => {
      visiteur2 = await Client.anonymous(app);
      await visiteur2.post('/auth/register', { email: email('visiteur2'), password: TEST_PASSWORD, prenom: 'V', nom: 'Deux' });
      await visiteur2.post('/auth/login', { email: email('visiteur2'), password: TEST_PASSWORD });
      expect((await visiteur2.get(`/orders/${commande}`)).statusCode).toBe(404);
      expect((await visiteur2.get(`/orders/${commande}/payments`)).statusCode).toBe(404);
      expect((await visiteur2.post(`/orders/${commande}/refund`)).statusCode).toBe(404);
      expect((await visiteur2.get('/orders/me')).json().total).toBe(0);
    });

    it('remboursement de sa commande, puis second remboursement → 409', async () => {
      const res = await visiteur.post(`/orders/${commande}/refund`);
      expect(res.statusCode).toBe(200);
      expect(res.json().statut).toBe('refunded');
      const payments = (await visiteur.get(`/orders/${commande}/payments`)).json();
      expect(payments.map((p: { type: string; montant: string }) => [p.type, p.montant])).toEqual([
        ['charge', '50.00'],
        ['refund', '-50.00'],
      ]);

      const again = await visiteur.post(`/orders/${commande}/refund`);
      expect(again.statusCode).toBe(409);
      expect(again.json().error).toBe('COMMANDE_NON_REMBOURSABLE');
    });

    it('un admin rembourse la commande d’un autre utilisateur', async () => {
      const { commandeId: id } = await buy(app, gateway, visiteur2, fx.tarifQuota5, 1);
      expect((await admin.get(`/orders/${id}`)).json().utilisateurId).toBeGreaterThan(0);
      const res = await admin.post(`/orders/${id}/refund`);
      expect(res.statusCode).toBe(200);
      expect(res.json().statut).toBe('refunded');
    });
  });

  // ---------------------------------------------------------------------------
  describe('liste d’attente', () => {
    let attente1: Client;
    let attente2: Client;
    let commande: number;
    let entree1: number;
    let entree2: number;

    const inscrit = async (name: string) => {
      const client = await Client.anonymous(app);
      await client.post('/auth/register', { email: email(name), password: TEST_PASSWORD, prenom: 'W', nom: name });
      await client.post('/auth/login', { email: email(name), password: TEST_PASSWORD });
      return client;
    };
    const mine = async (client: Client, id: number) =>
      (await client.get('/waitlist/me')).json().find((e: { id: number }) => e.id === id);

    it('inscription anonyme → 401 ; places disponibles → 409 PLACES_DISPONIBLES', async () => {
      expect((await anonyme.post('/waitlist', { tarifId: fx.tarifAttente, quantite: 1 })).statusCode).toBe(401);
      attente1 = await inscrit('attente1');
      attente2 = await inscrit('attente2');
      const res = await attente1.post('/waitlist', { tarifId: fx.tarifAttente, quantite: 1 });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('PLACES_DISPONIBLES');
    });

    it('tarif complet : inscriptions FIFO, double inscription → 409', async () => {
      commande = (await buy(app, gateway, visiteur, fx.tarifAttente, 1)).commandeId;

      const r1 = await attente1.post('/waitlist', { tarifId: fx.tarifAttente, quantite: 1 });
      expect(r1.statusCode).toBe(201);
      expect(r1.json()).toMatchObject({ statut: 'en_attente', position: 1, tarif: 'Attente' });
      entree1 = r1.json().id;
      const r2 = await attente2.post('/waitlist', { tarifId: fx.tarifAttente, quantite: 1 });
      expect(r2.json()).toMatchObject({ statut: 'en_attente', position: 2 });
      entree2 = r2.json().id;

      const again = await attente1.post('/waitlist', { tarifId: fx.tarifAttente, quantite: 1 });
      expect(again.statusCode).toBe(409);
      expect(again.json().error).toBe('DEJA_INSCRIT');
    });

    it('vue organisateur : file de ses tarifs uniquement (RLS), interdite aux visiteurs', async () => {
      const file = (await orgaA.get(`/waitlist/tarifs/${fx.tarifAttente}`)).json();
      expect(file.map((e: { id: number; position: number }) => [e.id, e.position])).toEqual([
        [entree1, 1],
        [entree2, 2],
      ]);
      expect(file[0]).not.toHaveProperty('utilisateurId');
      expect((await orgaB.get(`/waitlist/tarifs/${fx.tarifAttente}`)).json()).toEqual([]);
      expect((await visiteur.get(`/waitlist/tarifs/${fx.tarifAttente}`)).statusCode).toBe(403);
    });

    it('désistement : seul le premier inscrit reçoit l’offre, la place ne fuit pas', async () => {
      expect((await visiteur.post(`/orders/${commande}/refund`)).statusCode).toBe(200);

      expect(await mine(attente1, entree1)).toMatchObject({ statut: 'notifiee', expireA: expect.any(String) });
      expect(await mine(attente2, entree2)).toMatchObject({ statut: 'en_attente', position: 1 });

      const achat = await visiteur.post('/orders/hold', { tarifId: fx.tarifAttente, quantite: 1, modePaiement: 'carte' });
      expect(achat.statusCode).toBe(409);
      expect(achat.json().error).toBe('QUOTA_EPUISE');
      // L'offre est une réservation au nom du premier inscrit : un autre ne peut pas la payer.
      const offre: number = (await mine(attente1, entree1)).reservationId;
      expect(offre).toEqual(expect.any(Number));
      expect((await attente2.post(`/orders/holds/${offre}/checkout`)).statusCode).toBe(404);
      // Un inscrit encore en attente n'a aucune réservation à payer.
      expect((await mine(attente2, entree2)).reservationId).toBeNull();
    });

    it('offre refusée → passe au suivant, qui paie et obtient son billet', async () => {
      expect((await attente1.delete(`/waitlist/${entree1}`)).statusCode).toBe(204);
      expect(await mine(attente1, entree1)).toMatchObject({ statut: 'annulee', reservationId: null });
      const offre = await mine(attente2, entree2);
      expect(offre).toMatchObject({ statut: 'notifiee', reservationId: expect.any(Number) });

      const achat = await payHold(app, gateway, attente2, offre.reservationId);
      expect(achat.billetIds).toHaveLength(1);
      expect(await mine(attente2, entree2)).toMatchObject({ statut: 'confirmee' });

      const again = await attente2.post(`/orders/holds/${offre.reservationId}/checkout`);
      expect(again.statusCode).toBe(409);
      expect(again.json().error).toBe('RESERVATION_NON_ACTIVE');
    });
  });

  // ---------------------------------------------------------------------------
  describe('check-in', () => {
    let qr1: string;
    let qr2: string;
    const scan = (payload: string, clientScanId = crypto.randomUUID()) => ({
      clientScanId,
      payload,
      evenementId: fx.eventFutur,
      scanneA: new Date().toISOString(),
      appareil: 'e2e',
    });

    it('billets : QR signé exposé au titulaire', async () => {
      const ids = (await buy(app, gateway, visiteur, fx.tarifCheckin, 2)).billetIds;
      const tickets = (await visiteur.get('/tickets/me?pageSize=100')).json().items;
      [qr1, qr2] = ids.map((id) => tickets.find((t: { id: number }) => t.id === id).qrPayload);
      expect(qr1).toMatch(/^BT1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{22}$/);
    });

    it('accès : visiteur 403, organisateur d’un autre événement 403', async () => {
      expect((await visiteur.post('/checkin/scan', scan(qr1))).statusCode).toBe(403);
      expect((await visiteur.get(`/checkin/manifest?evenementId=${fx.eventFutur}`)).statusCode).toBe(403);
      const autre = await orgaB.post('/checkin/scan', scan(qr1));
      expect(autre.statusCode).toBe(403);
      expect(autre.json().error).toBe('ACTION_INTERDITE');
    });

    it('scan puis second scan du même billet → doublon avec info du premier', async () => {
      const premier = await orgaA.post('/checkin/scan', scan(qr1));
      expect(premier.statusCode).toBe(200);
      expect(premier.json()).toMatchObject({ resultat: 'ok', rejeu: false, tarif: 'Checkin', premierScan: null });

      const second = await orgaA.post('/checkin/scan', scan(qr1));
      expect(second.json()).toMatchObject({ resultat: 'doublon', premierScan: { appareil: 'e2e' } });
      expect(second.json().premierScan.recuA).toBe(premier.json().recuA);

      // Dernier caractère de la signature remplacé par un autre (jamais identique).
      const forge = await orgaA.post('/checkin/scan', scan(`${qr2.slice(0, -1)}${qr2.endsWith('A') ? 'B' : 'A'}`));
      expect(forge.json().resultat).toBe('invalide');
    });

    it('lot hors ligne rejoué dans le désordre → idempotent par clientScanId', async () => {
      const a = scan(qr2);
      const b = scan(qr2);
      const lot1 = (await orgaA.post('/checkin/scan/batch', { scans: [b, a] })).json();
      expect(lot1.map((r: { resultat: string }) => r.resultat)).toEqual(['ok', 'doublon']);

      const lot2 = await orgaA.post('/checkin/scan/batch', { scans: [a, b, a] });
      expect(lot2.statusCode).toBe(200);
      expect(lot2.json()).toEqual([
        expect.objectContaining({ clientScanId: a.clientScanId, resultat: 'doublon', rejeu: true }),
        expect.objectContaining({ clientScanId: b.clientScanId, resultat: 'ok', rejeu: true }),
        expect.objectContaining({ clientScanId: a.clientScanId, resultat: 'doublon', rejeu: true }),
      ]);

      const [{ n }] = await owner.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM billets_scans WHERE client_scan_id IN (${a.clientScanId}::uuid, ${b.clientScanId}::uuid)`;
      expect(Number(n)).toBe(2);
    });

    it('lot : une erreur métier n’annule pas les autres scans', async () => {
      const res = await orgaA.post('/checkin/scan/batch', {
        scans: [scan(qr1), { ...scan(qr1), evenementId: 999_999_999 }],
      });
      expect(res.json()).toEqual([
        expect.objectContaining({ status: 'done', resultat: 'doublon' }),
        expect.objectContaining({ status: 'error', error: 'EVENEMENT_INTROUVABLE' }),
      ]);
    });

    it('manifeste : billets payés et statut de scan', async () => {
      const manifest = (await orgaA.get(`/checkin/manifest?evenementId=${fx.eventFutur}`)).json();
      const mine = manifest.filter((m: { codeVerification: string }) =>
        [qr1, qr2].some((qr) => qr.endsWith(`.${m.codeVerification}`)),
      );
      expect(mine).toHaveLength(2);
      expect(mine.every((m: { dejaScanne: boolean }) => m.dejaScanne)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  describe('dashboard live', () => {
    interface LiveEvent {
      evenementId: number;
      vendus: number;
      reserves: number;
      enAttente: number;
      places: number;
    }
    const liveOf = async (client: Client) => {
      const res = await client.get('/analytics/live');
      expect(res.statusCode).toBe(200);
      return res.json() as { totaux: { vendus: number; reserves: number }; evenements: LiveEvent[] };
    };
    const futur = (live: { evenements: LiveEvent[] }) => live.evenements.find((e) => e.evenementId === fx.eventFutur);

    it('accès : visiteur 403 ; réponse jamais mise en cache', async () => {
      expect((await visiteur.get('/analytics/live')).statusCode).toBe(403);
      expect((await orgaA.get('/analytics/live')).headers['cache-control']).toBe('no-store');
    });

    it('un achat et un hold apparaissent immédiatement (vendu / réservé)', async () => {
      const avant = futur(await liveOf(orgaA));
      if (!avant) throw new Error('événement de test absent du dashboard live');

      await buy(app, gateway, visiteur, fx.tarifLive, 2);
      expect((await visiteur.post('/orders/hold', { tarifId: fx.tarifLive, quantite: 1, modePaiement: 'virement' })).statusCode).toBe(201);

      const apres = futur(await liveOf(orgaA));
      expect(apres).toMatchObject({ vendus: avant.vendus + 2, reserves: avant.reserves + 1 });
    });

    it('chiffres identiques aux comptes directs en base', async () => {
      const live = futur(await liveOf(orgaA));
      const [base = { vendus: -1n, reserves: -1n, attente: -1n }] = await owner.$queryRaw<
        { vendus: bigint; reserves: bigint; attente: bigint }[]
      >`
        SELECT (SELECT count(*) FROM billets b JOIN commandes c ON c.id = b.commande_id JOIN tarifs t ON t.id = b.tarif_id
                WHERE t.evenement_id = ${fx.eventFutur} AND c.statut = 'paid') AS vendus,
               (SELECT coalesce(sum(r.quantite), 0) FROM reservations r JOIN tarifs t ON t.id = r.tarif_id
                WHERE t.evenement_id = ${fx.eventFutur} AND r.statut = 'active' AND r.expire_a > now()) AS reserves,
               (SELECT coalesce(sum(la.quantite_souhaitee), 0) FROM liste_attente la JOIN tarifs t ON t.id = la.tarif_id
                WHERE t.evenement_id = ${fx.eventFutur} AND la.statut = 'en_attente') AS attente`;
      expect(live).toMatchObject({ vendus: Number(base.vendus), reserves: Number(base.reserves), enAttente: Number(base.attente) });
    });

    it('isolation multi-tenant : l’organisateur B ne voit pas les événements de A', async () => {
      const liveB = await liveOf(orgaB);
      expect(futur(liveB)).toBeUndefined();
      const [{ autres }] = await owner.$queryRaw<{ autres: bigint }[]>`
        SELECT count(*) AS autres FROM evenements
        WHERE id = ANY(${liveB.evenements.map((e) => e.evenementId)}::bigint[]) AND organisateur_id <> ${fx.orgaB}`;
      expect(Number(autres)).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  describe('souhaits secondaires (phase 15)', () => {
    it('achat : e-mail de confirmation mis en file (outbox) dans la même transaction', async () => {
      const achat = await buy(app, gateway, visiteur, fx.tarifQuota5, 1);
      const [row] = await owner.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM emails_sortants
        WHERE type = 'commande_confirmee' AND commande_id = ${achat.commandeId}::bigint AND statut = 'a_envoyer'`;
      expect(Number(row?.n)).toBe(1);
    });

    it('annulation self-service : date limite exposée, refusée après le délai (409)', async () => {
      const { commandeId: id } = await buy(app, gateway, visiteur, fx.tarifProche, 1);

      const detail = (await visiteur.get(`/orders/${id}`)).json();
      expect(new Date(detail.annulationPossibleJusqua).getTime()).toBeLessThan(Date.now());
      const ticket = (await visiteur.get('/tickets/me?pageSize=100')).json().items.find(
        (t: { commandeId: number }) => t.commandeId === id,
      );
      expect(ticket.annulationPossibleJusqua).toBe(detail.annulationPossibleJusqua);

      const refus = await visiteur.post(`/orders/${id}/refund`);
      expect(refus.statusCode).toBe(409);
      expect(refus.json().error).toBe('DELAI_ANNULATION_DEPASSE');

      // L'admin n'est pas soumis au délai.
      expect((await admin.post(`/orders/${id}/refund`)).statusCode).toBe(200);
    });

    it('délai configurable par l’organisateur ; fuseau et événement en ligne exposés', async () => {
      const patch = await orgaA.patch(`/events/${fx.eventProche}`, {
        delaiAnnulationHeures: 2,
        enLigne: true,
        fuseauHoraire: 'America/New_York',
      });
      expect(patch.statusCode).toBe(200);
      expect(patch.json()).toMatchObject({ delaiAnnulationHeures: 2, enLigne: true, fuseauHoraire: 'America/New_York' });

      const invalide = await orgaA.patch(`/events/${fx.eventProche}`, { fuseauHoraire: 'Mars/Olympus' });
      expect(invalide.statusCode).toBe(400);

      const liste = (await anonyme.get('/events?q=e2e-proche&pageSize=10')).json().items;
      expect(liste.find((e: { id: number }) => e.id === fx.eventProche)).toMatchObject({
        enLigne: true,
        fuseauHoraire: 'America/New_York',
      });

      // Délai ramené à 2 h : l'annulation redevient possible.
      const achat = await buy(app, gateway, visiteur, fx.tarifProche, 1);
      expect((await visiteur.post(`/orders/${achat.commandeId}/refund`)).statusCode).toBe(200);
    });

    it('export CSV des participants : en-têtes, un billet par ligne, accès restreint', async () => {
      const res = await orgaA.get(`/events/${fx.eventProche}/participants/export`);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/^text\/csv; charset=utf-8/);
      expect(res.headers['content-disposition']).toBe(`attachment; filename="participants-e2e-proche-${RUN}.csv"`);
      const lines = res.body.replace(/^\uFEFF/, '').trimEnd().split('\r\n');
      // Pas de code de billet dans l'export : un fichier qui circule ne permet pas de refaire un QR.
      expect(lines[0]).toBe('billet;tarif;prix_paye;prenom;nom;commande;statut_commande;achete_le;scanne;scanne_le');
      expect(res.body).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);

      const [base] = await owner.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM billets b JOIN tarifs t ON t.id = b.tarif_id WHERE t.evenement_id = ${fx.eventProche}`;
      expect(lines).toHaveLength(Number(base?.n) + 1);
      expect(lines.slice(1).every((l) => l.split(';').length === 10)).toBe(true);
      expect(lines.slice(1).map((l) => l.split(';')[6])).toEqual(expect.arrayContaining(['refunded']));

      expect((await orgaB.get(`/events/${fx.eventProche}/participants/export`)).statusCode).toBe(403);
      expect((await visiteur.get(`/events/${fx.eventProche}/participants/export`)).statusCode).toBe(403);
      expect((await admin.get(`/events/${fx.eventProche}/participants/export`)).statusCode).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------
  describe('organisateurs', () => {
    let evenement: number;
    let tarif: number;

    it('un visiteur ne peut pas créer d’événement → 403', async () => {
      const res = await visiteur.post('/events', {
        nom: 'X', slug: `x-${Date.now()}`, debut: '2027-01-01T20:00:00Z', fin: '2027-01-01T23:00:00Z', lieuId: 1, typeEvenementId: 3,
      });
      expect(res.statusCode).toBe(403);
    });

    it('l’organisateur A crée un brouillon pour lui-même ; invisible du public', async () => {
      const res = await orgaA.post('/events', {
        nom: 'Créé en e2e',
        slug: `e2e-cree-${RUN}`,
        debut: new Date(Date.now() + 60 * 86_400_000).toISOString(),
        fin: new Date(Date.now() + 60 * 86_400_000 + 3 * 3_600_000).toISOString(),
        lieuId: 1,
        typeEvenementId: 3,
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ organisateurId: fx.orgaA, statut: 'draft' });
      evenement = res.json().id;
      expect((await anonyme.get(`/events/${evenement}`)).statusCode).toBe(404);
      // Catalogue public (défaut) : même l'organisateur ne voit pas son brouillon ; gestion : oui.
      expect((await orgaA.get(`/events/${evenement}`)).statusCode).toBe(404);
      expect((await orgaA.get(`/events/${evenement}?scope=manage`)).statusCode).toBe(200);
    });

    it('scope : catalogue public complet pour un organisateur connecté, gestion limitée à ses événements', async () => {
      const publicList = (await orgaA.get('/events?pageSize=1')).json();
      const anonymousList = (await anonyme.get('/events?pageSize=1')).json();
      expect(publicList.total).toBe(anonymousList.total);

      const manage = (await orgaA.get('/events?pageSize=100&scope=manage')).json();
      const [{ n }] = await owner.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM evenements WHERE organisateur_id = ${fx.orgaA}`;
      expect(manage.total).toBe(Number(n));
      expect(manage.total).toBeLessThan(publicList.total);

      // Un visiteur qui demande « manage » n'obtient que ses droits de visiteur.
      expect((await visiteur.get('/events?pageSize=1&scope=manage')).json().total).toBe(anonymousList.total);
      expect((await anonyme.get('/events?scope=tout')).statusCode).toBe(400);
    });

    it('l’organisateur A ne peut pas créer pour B', async () => {
      const res = await orgaA.post('/events', {
        nom: 'Usurpation', slug: `usurpation-${Date.now()}`, debut: '2027-01-01T20:00:00Z', fin: '2027-01-01T23:00:00Z',
        lieuId: 1, typeEvenementId: 3, organisateurId: fx.orgaB,
      });
      expect(res.statusCode).toBe(403);
    });

    it('l’organisateur B ne voit ni ne modifie les événements de A (RLS) → 404', async () => {
      expect((await orgaB.get(`/events/${evenement}?scope=manage`)).statusCode).toBe(404);
      expect((await orgaB.patch(`/events/${evenement}`, { nom: 'Piraté' })).statusCode).toBe(404);
      expect((await orgaB.delete(`/events/${evenement}`)).statusCode).toBe(404);
      expect((await orgaB.post(`/events/${evenement}/prices`, {
        nom: 'Intrus', prix: 1, quota: 1, dateDebutVente: new Date().toISOString(), dateFinVente: new Date(Date.now() + 86_400_000).toISOString(),
      })).statusCode).toBe(404);
      const liste = (await orgaB.get('/events?pageSize=100&scope=manage')).json();
      expect(liste.items.every((e: { id: number }) => e.id !== evenement)).toBe(true);
    });

    it('tarifs : création, modification auditée avec l’auteur, suppression', async () => {
      const created = await orgaA.post(`/events/${evenement}/prices`, {
        nom: 'Standard',
        prix: 30,
        quota: 100,
        dateDebutVente: new Date().toISOString(),
        dateFinVente: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      });
      expect(created.statusCode).toBe(201);
      tarif = created.json().id;
      expect(created.json()).toMatchObject({ prix: '30.00', restantes: 100 });

      const updated = await orgaA.patch(`/prices/${tarif}`, { prix: 35.5 });
      expect(updated.statusCode).toBe(200);
      expect(updated.json().prix).toBe('35.50');

      const me = (await orgaA.get('/auth/me')).json().user;
      const journal = await owner.$queryRaw<{ ancien_prix: string; nouveau_prix: string; auteur: string }[]>`
        SELECT ancien_prix::text, nouveau_prix::text, auteur FROM journal_tarifs WHERE tarif_id = ${tarif}`;
      expect(journal).toEqual([{ ancien_prix: '30.00', nouveau_prix: '35.50', auteur: String(me.id) }]);

      expect((await orgaB.patch(`/prices/${tarif}`, { prix: 1 })).statusCode).toBe(404);
      expect((await orgaA.delete(`/prices/${tarif}`)).statusCode).toBe(204);
    });

    it('attributs (EAV) : remplacement, validation par trigger, isolement entre organisateurs', async () => {
      const ok = await orgaA.request('PUT', `/events/${evenement}/attributes`, [
        { cle: 'age_minimum', valeur: '18' },
        { cle: 'parking', valeur: 'oui' },
      ]);
      expect(ok.statusCode).toBe(200);
      expect(ok.json().attributs).toEqual([
        { cle: 'age_minimum', valeur: '18' },
        { cle: 'parking', valeur: 'oui' },
      ]);

      const invalide = await orgaA.request('PUT', `/events/${evenement}/attributes`, [{ cle: 'age_minimum', valeur: 'dix-huit' }]);
      expect(invalide.statusCode).toBe(422);
      expect(invalide.json().error).toBe('ATTRIBUT_INVALIDE');
      // La transaction a été annulée : les attributs précédents sont intacts.
      expect((await orgaA.get(`/events/${evenement}?scope=manage`)).json().attributs).toHaveLength(2);

      expect((await orgaA.request('PUT', `/events/${evenement}/attributes`, [{ cle: 'Clé Invalide', valeur: 'x' }])).statusCode).toBe(400);
      expect((await orgaB.request('PUT', `/events/${evenement}/attributes`, [])).statusCode).toBe(404);
    });

    it('publication puis visibilité publique ; suppression', async () => {
      expect((await orgaA.patch(`/events/${evenement}`, { statut: 'published' })).statusCode).toBe(200);
      expect((await anonyme.get(`/events/${evenement}`)).statusCode).toBe(200);
      expect((await orgaA.patch(`/events/${evenement}`, { organisateurId: fx.orgaB })).statusCode).toBe(400);
      expect((await orgaA.delete(`/events/${evenement}`)).statusCode).toBe(204);
      expect((await orgaA.get(`/events/${evenement}?scope=manage`)).statusCode).toBe(404);
    });

    it('analytics : l’organisateur ne voit que ses événements', async () => {
      const summary = (await orgaA.get('/analytics/summary')).json();
      expect(summary.source).toBe('vues');

      const ventes = (await orgaA.get('/analytics/events?pageSize=100')).json();
      const [{ n }] = await owner.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM evenements WHERE organisateur_id = ${fx.orgaA}`;
      expect(ventes.items.length).toBe(Number(n));
      expect(ventes.items.map((e: { evenementId: number }) => e.evenementId)).toContain(fx.eventFutur);
      expect(ventes.items.map((e: { evenementId: number }) => e.evenementId)).not.toContain(fx.eventDraftB);

      expect((await orgaA.get('/analytics/daily-sales')).statusCode).toBe(200);
      expect((await orgaA.get('/analytics/recent-orders?limit=5')).statusCode).toBe(200);
      expect((await visiteur.get('/analytics/summary')).statusCode).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  describe('administration', () => {
    it('analytics admin depuis la vue matérialisée', async () => {
      const summary = (await admin.get('/analytics/summary')).json();
      expect(summary.source).toBe('vue_materialisee');
      expect(Number(summary.chiffreAffaires)).toBeGreaterThan(0);
      expect(summary.commandes).toBeGreaterThan(0);
      expect(typeof summary.billetsVendus).toBe('number');
      const daily = await admin.get('/analytics/daily-sales?from=2025-01-01&to=2026-01-01');
      expect(daily.statusCode).toBe(200);
      expect(daily.json().length).toBeGreaterThan(0);
    });

    it('journal d’audit des tarifs : admin uniquement, auteur résolu en e-mail', async () => {
      const res = await admin.get('/analytics/price-audit?limit=20');
      expect(res.body).toContain('"auteur"');
      expect(res.statusCode).toBe(200);
      expect(res.json()).toContainEqual(
        expect.objectContaining({ action: 'UPDATE', ancienPrix: '30.00', nouveauPrix: '35.50', auteur: fx.userOrgaA }),
      );
      expect((await orgaA.get('/analytics/price-audit')).statusCode).toBe(403);
    });

    it('utilisateurs : e-mails visibles de l’admin seulement', async () => {
      const res = await admin.get(`/users?q=${encodeURIComponent('e2e-')}`);
      expect(res.statusCode).toBe(200);
      expect(res.json().items[0]).toHaveProperty('email');
      expect(JSON.stringify(res.json())).not.toMatch(/argon2|password/i);
      expect((await orgaA.get('/users')).statusCode).toBe(403);
    });

    it('changement de rôle incohérent refusé par la contrainte PostgreSQL → 422', async () => {
      const [{ id }] = await owner.$queryRaw<{ id: bigint }[]>`SELECT id FROM utilisateurs WHERE email = ${email('visiteur2')}`;
      const res = await admin.patch(`/users/${id}/role`, { role: 'organizer', organisateurId: null });
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toBe('CONTRAINTE_VIOLEE');
    });
  });

  // ---------------------------------------------------------------------------
  describe('base documentaire MongoDB (pages, avis, activités)', () => {
    let avisId: string;

    afterAll(async () => {
      // Documents rattachés aux événements de test (PostgreSQL les supprime dans cleanFixtures).
      const mongo = app.get(MongoService);
      await Promise.all([
        mongo.eventPages.deleteMany({ evenementId: fx.eventFutur }),
        mongo.avis.deleteMany({ evenementId: fx.eventFutur }),
        mongo.activites.deleteMany({ evenementId: fx.eventFutur }),
      ]);
    });

    it('page d’événement sans document : contenu par défaut, croisé avec l’événement SQL', async () => {
      const res = await anonyme.get(`/events/${fx.eventFutur}/page`);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        personnalisee: false,
        evenement: { id: fx.eventFutur, statut: 'published' },
        page: { evenementId: fx.eventFutur, programme: [] },
        template: { templateId: expect.any(String) },
      });
      expect((await anonyme.get('/events/slug-inconnu/page')).statusCode).toBe(404);
    });

    it('PUT page : un autre organisateur → 404 (RLS), le propriétaire → page enregistrée dans MongoDB', async () => {
      const page = {
        templateId: 'concert',
        tags: ['nocturne'],
        programme: [{ heure: '2027-01-01T20:00:00Z', scene: 'Grande scène', titre: 'Ouverture', artiste: 'E2E Band', dureeMin: 45 }],
        medias: [{ type: 'image', url: 'https://example.test/affiche.jpg', legende: 'Affiche' }],
        sections: [{ title: 'Accès', content: 'Métro ligne 1' }],
        faq: [{ question: 'Vestiaire ?', answer: 'Oui' }],
      };
      expect((await orgaB.request('PUT', `/events/${fx.eventFutur}/page`, page)).statusCode).toBe(404);
      expect((await visiteur.request('PUT', `/events/${fx.eventFutur}/page`, page)).statusCode).toBe(403);

      const invalide = await orgaA.request('PUT', `/events/${fx.eventFutur}/page`, { ...page, medias: [{ type: 'image', url: 'ftp://x' }] });
      expect(invalide.statusCode).toBe(400);
      expect((await orgaA.request('PUT', `/events/${fx.eventFutur}/page`, { ...page, templateId: 'inexistant' })).statusCode).toBe(404);

      const ok = await orgaA.request('PUT', `/events/${fx.eventFutur}/page`, page);
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({ evenementId: fx.eventFutur, templateId: 'concert', programme: [{ artiste: 'E2E Band' }] });

      // Relecture croisée : la page vient de MongoDB, l'événement de PostgreSQL, le template est celui de la page.
      const relu = (await anonyme.get(`/events/${fx.eventFutur}/page`)).json();
      expect(relu).toMatchObject({ personnalisee: true, page: { tags: ['nocturne'] }, template: { templateId: 'concert' } });
      expect((await anonyme.get(`/events/${fx.eventFutur}`)).json().template.templateId).toBe('concert');
    });

    it('avis : billet payé requis (403), création (201), doublon (409), note invalide (400)', async () => {
      expect((await anonyme.post(`/events/${fx.eventFutur}/avis`, { note: 5, commentaire: 'x' })).statusCode).toBe(401);
      const sansBillet = await visiteur2.post(`/events/${fx.eventFutur}/avis`, { note: 5, commentaire: 'Super' });
      expect(sansBillet.statusCode).toBe(403);
      expect(sansBillet.json().error).toBe('BILLET_REQUIS');

      expect((await visiteur.post(`/events/${fx.eventFutur}/avis`, { note: 7, commentaire: 'x' })).statusCode).toBe(400);

      const res = await visiteur.post(`/events/${fx.eventFutur}/avis`, { note: 4, titre: 'Bien', commentaire: 'Très bonne soirée' });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ evenementId: fx.eventFutur, note: 4, prenom: 'Camille', utile: 0, estLeMien: true });
      avisId = res.json().id;

      const doublon = await visiteur.post(`/events/${fx.eventFutur}/avis`, { note: 1, commentaire: 'Encore' });
      expect(doublon.statusCode).toBe(409);
      expect(doublon.json().error).toBe('DOUBLON');
    });

    it('liste publique des avis avec statistiques (pipeline d’agrégation)', async () => {
      const res = await anonyme.get(`/events/${fx.eventFutur}/avis`);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        total: 1,
        items: [{ id: avisId, note: 4 }],
        stats: { nbAvis: 1, moyenne: 4, distribution: { '1': 0, '2': 0, '3': 0, '4': 1, '5': 0 }, tauxReponse: 0 },
      });
      expect((await anonyme.get(`/events/${fx.eventFutur}/avis?noteMin=5`)).json().total).toBe(0);

      // L'identifiant de l'auteur n'est jamais exposé ; seul l'auteur connecté voit « estLeMien ».
      expect(res.body).not.toContain('utilisateurId');
      expect(res.json().items[0].estLeMien).toBe(false);
      expect((await visiteur.get(`/events/${fx.eventFutur}/avis`)).json().items[0].estLeMien).toBe(true);
      expect((await visiteur2.get(`/events/${fx.eventFutur}/avis`)).json().items[0].estLeMien).toBe(false);
    });

    it('modification par l’auteur seulement ; réponse de l’organisateur propriétaire seulement', async () => {
      expect((await visiteur2.patch(`/avis/${avisId}`, { note: 1 })).statusCode).toBe(403);
      expect((await visiteur.patch(`/avis/${avisId}`, { note: 5 })).json().note).toBe(5);

      expect((await orgaB.post(`/avis/${avisId}/reponse`, { texte: 'Merci' })).statusCode).toBe(403);
      const reponse = await orgaA.post(`/avis/${avisId}/reponse`, { texte: 'Merci pour votre retour' });
      expect(reponse.statusCode).toBe(200);
      expect(reponse.json().reponseOrganisateur).toMatchObject({ texte: 'Merci pour votre retour' });

      const mine = (await orgaA.get('/organizer/avis')).json();
      expect(mine.items.map((a: { id: string }) => a.id)).toContain(avisId);
      expect((await orgaA.get('/organizer/avis?sansReponse=true')).json().items.map((a: { id: string }) => a.id)).not.toContain(avisId);
      expect((await anonyme.get(`/events/${fx.eventFutur}/avis`)).json().stats.tauxReponse).toBe(1);
    });

    it('journal d’activité : écriture explicite, tendances croisées avec PostgreSQL, série de l’organisateur', async () => {
      const mongo = app.get(MongoService);
      const avant = await mongo.activites.countDocuments({ evenementId: fx.eventFutur });
      // Écriture réservée aux comptes connectés, pour un événement visible, avec un contenu borné.
      expect((await anonyme.post('/activites', { type: 'vue_evenement', evenementId: fx.eventFutur })).statusCode).toBe(401);
      const rec = await visiteur.post('/activites', { type: 'vue_evenement', evenementId: fx.eventFutur, payload: { source: 'e2e' } });
      expect(rec.statusCode).toBe(201);
      expect((await visiteur.post('/activites', { type: 'scan_checkin', evenementId: fx.eventFutur })).statusCode).toBe(400);
      expect((await visiteur.post('/activites', { type: 'vue_evenement', evenementId: fx.eventDraftB })).statusCode).toBe(404);
      expect((await visiteur.post('/activites', { type: 'vue_evenement', evenementId: 999_999_999 })).statusCode).toBe(404);
      expect((await visiteur.post('/activites', { type: 'recherche', payload: { $where: 'x' } })).statusCode).toBe(400);
      expect((await visiteur.post('/activites', { type: 'recherche', payload: { 'a.b': 'x' } })).statusCode).toBe(400);
      const tropDeCles = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`cle${i}`, i]));
      expect((await visiteur.post('/activites', { type: 'recherche', payload: tropDeCles })).statusCode).toBe(400);

      // Ce qu'un navigateur déclare ne compte pas dans le classement : 50 « vues » déclarées n'y changent rien.
      const scoreDe = async () =>
        ((await anonyme.get('/events/tendances?jours=7&limit=50')).json() as { evenementId: number; score: number }[]).find(
          (i) => i.evenementId === fx.eventFutur,
        )?.score ?? 0;
      const scoreAvant = await scoreDe();
      await Promise.all(
        Array.from({ length: 50 }, () => visiteur.post('/activites', { type: 'vue_evenement', evenementId: fx.eventFutur })),
      );
      expect(await scoreDe()).toBe(scoreAvant);
      // Les lectures précédentes (GET /events/:id) et l'achat ont aussi été journalisés par l'API.
      expect(await mongo.activites.countDocuments({ evenementId: fx.eventFutur })).toBeGreaterThan(avant);

      const tendances = await anonyme.get('/events/tendances?jours=7&limit=5');
      expect(tendances.statusCode).toBe(200);
      const items = tendances.json() as { evenementId: number; score: number; evenement: { id: number; statut: string } }[];
      expect(items.length).toBeGreaterThan(0);
      expect(items.length).toBeLessThanOrEqual(5);
      for (const item of items) {
        expect(item.evenement.id).toBe(item.evenementId);
        expect(['published', 'finished']).toContain(item.evenement.statut);
      }
      expect(items.map((i) => i.score)).toEqual([...items.map((i) => i.score)].sort((a, b) => b - a));

      const serie = await orgaA.get(`/activites/evenements/${fx.eventFutur}?granularite=jour&jours=1`);
      expect(serie.statusCode).toBe(200);
      expect(serie.json()[0]).toMatchObject({ total: expect.any(Number), parType: expect.any(Object) });
      expect((await orgaB.get(`/activites/evenements/${fx.eventFutur}`)).statusCode).toBe(404);

      expect((await visiteur.delete('/activites?avant=2000-01-01')).statusCode).toBe(403);
      expect((await admin.delete('/activites?avant=2000-01-01')).json()).toEqual({ supprimees: 0 });
    });

    it('suppressions : avis par son auteur (204), page par l’organisateur (204)', async () => {
      expect((await visiteur2.delete(`/avis/${avisId}`)).statusCode).toBe(403);
      expect((await visiteur.delete(`/avis/${avisId}`)).statusCode).toBe(204);
      expect((await visiteur.delete(`/avis/${avisId}`)).statusCode).toBe(404);

      expect((await orgaA.delete(`/events/${fx.eventFutur}/page`)).statusCode).toBe(204);
      expect((await anonyme.get(`/events/${fx.eventFutur}/page`)).json().personnalisee).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  describe('concurrence', () => {
    it('30 réservations simultanées sur un quota de 5 → exactement 5 places bloquées', async () => {
      const results = await Promise.all(
        Array.from({ length: 30 }, () =>
          visiteur.post('/orders/hold', { tarifId: fx.tarifConcurrence, quantite: 1, modePaiement: 'carte' }),
        ),
      );
      const statuses = results.map((r) => r.statusCode);
      expect(statuses.filter((s) => s === 201)).toHaveLength(5);
      expect(statuses.filter((s) => s === 409)).toHaveLength(25);
      expect(results.filter((r) => r.statusCode === 409).every((r) => r.json().error === 'QUOTA_EPUISE')).toBe(true);

      const [{ reserves }] = await owner.$queryRaw<{ reserves: bigint }[]>`
        SELECT coalesce(sum(quantite), 0) AS reserves FROM reservations
        WHERE tarif_id = ${fx.tarifConcurrence} AND statut = 'active'`;
      expect(Number(reserves)).toBe(5);
    });

    it('webhooks simultanés pour le même paiement → une seule commande', async () => {
      const [mine] = (await visiteur.get('/orders/holds/me')).json().filter(
        (h: { tarifId: number; statut: string }) => h.tarifId === fx.tarifConcurrence && h.statut === 'active',
      );
      const checkout = await visiteur.post(`/orders/holds/${mine.id}/checkout`);
      const sessionId = sessionIdOf(checkout.json().url);
      gateway.pay(sessionId);
      const eventId = `evt_e2e_conc_${RUN}`;
      const results = await Promise.all(Array.from({ length: 10 }, () => deliverWebhook(app, sessionId, { eventId })));
      expect(results.every((r) => r.statusCode === 200)).toBe(true);
      expect(results.filter((r) => r.json().resultat === 'traite')).toHaveLength(1);
      expect(results.filter((r) => r.json().resultat === 'doublon')).toHaveLength(9);

      const [{ billets }] = await owner.$queryRaw<{ billets: bigint }[]>`
        SELECT count(*) AS billets FROM billets WHERE tarif_id = ${fx.tarifConcurrence}`;
      expect(Number(billets)).toBe(1);
    });
  });
});
