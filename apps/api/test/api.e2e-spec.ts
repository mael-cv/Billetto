import { createHmac } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaService } from '../src/common/database/prisma.service';
import { cleanFixtures, createFixtures, email, type Fixtures } from './fixtures';
import { Client, DEMO_PASSWORD, owner, RUN, startApp, TEST_PASSWORD, testConfig } from './support';

/**
 * Tests de bout en bout sur la vraie base PostgreSQL (migrations 001–006 + seed).
 * L'API se connecte en billetto_app : chaque vérification d'accès ci-dessous est
 * appliquée par PostgreSQL (GRANT, RLS, fonctions), pas seulement par l'API.
 */
describe('API Billetto (e2e)', () => {
  // security-audit-ignore: generic-secret -- secret HMAC éphémère des tests e2e
  const webhookSecret = 'api-e2e-webhook-secret-with-at-least-32-characters';
  let app: NestFastifyApplication;
  let fx: Fixtures;
  let anonyme: Client;
  let visiteur: Client;
  let visiteur2: Client;
  let orgaA: Client;
  let orgaB: Client;
  let admin: Client;

  beforeAll(async () => {
    fx = await createFixtures();
    app = await startApp(testConfig({ PAYMENTS_WEBHOOK_SECRET: webhookSecret }));
    anonyme = await Client.anonymous(app);
    visiteur = await Client.login(app, 'demo-visiteur@billetto.test', DEMO_PASSWORD);
    orgaA = await Client.login(app, 'demo-organisateur@billetto.test', DEMO_PASSWORD);
    orgaB = await Client.login(app, fx.userOrgaB, TEST_PASSWORD);
    admin = await Client.login(app, 'demo-admin@billetto.test', DEMO_PASSWORD);
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
      expect(res.json()).toEqual({ status: 'ok', database: 'up' });
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
      const res = await visiteur.post('/tickets/purchase', { tarifId: fx.tarifQuota5, quantite: 1 }, { 'x-csrf-token': '' });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe('CSRF_INVALIDE');
    });

    it('requête modifiante depuis une origine étrangère (jeton valide) → 403', async () => {
      const res = await visiteur.post(
        '/tickets/purchase',
        { tarifId: fx.tarifQuota5, quantite: 1 },
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
      const res = await visiteur.post('/tickets/purchase', { tarifId: 'abc', quantite: 0, prix: 0 });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'VALIDATION', message: 'Requête invalide' });
      expect(res.json().details.length).toBeGreaterThanOrEqual(2);
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
    it('rejette une signature invalide, puis confirme une fois et rend le rejeu idempotent', async () => {
      const [tarif] = await owner.$queryRaw<{ id: bigint }[]>`
        INSERT INTO tarifs (evenement_id, nom, prix, quota, date_debut_vente, date_fin_vente)
        VALUES (${fx.eventFutur}, ${`Webhook ${RUN}`}, 25, 3, now() - interval '1 day', now() + interval '29 days')
        RETURNING id`;
      const [buyer] = await owner.$queryRaw<{ id: bigint }[]>`
        SELECT id FROM utilisateurs WHERE email = 'demo-visiteur@billetto.test'`;
      const [hold] = await owner.$queryRaw<{ reservation_id: bigint }[]>`
        SELECT reservation_id FROM creer_reservation(${buyer.id}, ${tarif.id}, 1, 'carte')`;
      const event = {
        eventId: `e2e-webhook-${RUN}`,
        type: 'payment.succeeded',
        reservationId: Number(hold.reservation_id),
      };
      const rawBody = JSON.stringify(event);
      const invalid = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/webhook',
        payload: rawBody,
        headers: { 'content-type': 'application/json', 'x-billetto-signature': '0'.repeat(64) },
      });
      expect(invalid.statusCode).toBe(401);
      expect(invalid.json()).toMatchObject({ error: 'SIGNATURE_WEBHOOK_INVALIDE' });

      const signature = createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
      const deliver = () =>
        app.inject({
          method: 'POST',
          url: '/api/v1/payments/webhook',
          payload: rawBody,
          headers: { 'content-type': 'application/json', 'x-billetto-signature': signature },
        });
      const first = await deliver();
      const replay = await deliver();
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({ duplicate: false, commandeId: expect.any(Number), billetIds: [expect.any(Number)] });
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toMatchObject({ duplicate: true, commandeId: null, billetIds: null });

      const [{ webhook_count, ticket_count }] = await owner.$queryRaw<{ webhook_count: bigint; ticket_count: bigint }[]>`
        SELECT (SELECT count(*) FROM paiement_webhooks WHERE evenement_externe_id = ${event.eventId}) AS webhook_count,
               (SELECT count(*) FROM billets WHERE commande_id = ${first.json().commandeId}) AS ticket_count`;
      expect(Number(webhook_count)).toBe(1);
      expect(Number(ticket_count)).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  describe('authentification', () => {
    it('inscription : cookie de session HttpOnly + SameSite=Strict, rôle visitor imposé', async () => {
      const client = await Client.anonymous(app);
      const res = await client.post('/auth/register', {
        email: email('inscrit'),
        password: TEST_PASSWORD,
        prenom: 'Nouveau',
        nom: 'Compte',
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().user).toMatchObject({ role: 'visitor', email: email('inscrit') });
      const session = res.cookies.find((c) => c.name === 'billetto_session');
      expect(session).toMatchObject({ httpOnly: true, sameSite: 'Strict', secure: true });
      expect((await client.get('/auth/me')).statusCode).toBe(200);
    });

    it('inscription : rôle non modifiable, mot de passe court refusé, e-mail en double → 409', async () => {
      const client = await Client.anonymous(app);
      const escalade = await client.post('/auth/register', {
        email: email('escalade'),
        password: TEST_PASSWORD,
        prenom: 'X',
        nom: 'Y',
        role: 'admin',
      });
      expect(escalade.statusCode).toBe(400);
      expect(
        (await client.post('/auth/register', { email: email('court'), password: 'court', prenom: 'X', nom: 'Y' })).statusCode,
      ).toBe(400);
      const doublon = await client.post('/auth/register', {
        email: 'demo-visiteur@billetto.test',
        password: TEST_PASSWORD,
        prenom: 'X',
        nom: 'Y',
      });
      expect(doublon.statusCode).toBe(409);
    });

    it('connexion : même réponse pour mauvais mot de passe et compte inconnu', async () => {
      const client = await Client.anonymous(app);
      const faux = await client.post('/auth/login', { email: 'demo-visiteur@billetto.test', password: 'mauvais' });
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

      const client = await Client.login(app, 'demo-visiteur@billetto.test', DEMO_PASSWORD);
      expect((await client.post('/auth/logout')).statusCode).toBe(204);
      expect((await client.get('/auth/me')).statusCode).toBe(401);
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

    it('achat anonyme → 401', async () => {
      expect((await anonyme.post('/tickets/purchase', { tarifId: fx.tarifQuota5, quantite: 1 })).statusCode).toBe(401);
    });

    it('achat valide → 201, visible dans billets et commandes', async () => {
      const res = await visiteur.post('/tickets/purchase', { tarifId: fx.tarifQuota5, quantite: 2 });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ montantTotal: '50.00', billetIds: [expect.any(Number), expect.any(Number)] });
      commande = res.json().commandeId;

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

    it('quota épuisé → 409 QUOTA_EPUISE (règle appliquée par acheter_billet)', async () => {
      const res = await visiteur.post('/tickets/purchase', { tarifId: fx.tarifQuota5, quantite: 4 });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'QUOTA_EPUISE' });
      expect(res.json().message).toMatch(/3 restant/);
    });

    it('événement commencé → 409, tarif inexistant → 404', async () => {
      const commence = await visiteur.post('/tickets/purchase', { tarifId: fx.tarifCommence, quantite: 1 });
      expect(commence.statusCode).toBe(409);
      expect(commence.json().error).toBe('EVENEMENT_COMMENCE');

      const inexistant = await visiteur.post('/tickets/purchase', { tarifId: 999_999_999, quantite: 1 });
      expect(inexistant.statusCode).toBe(404);
      expect(inexistant.json().error).toBe('TARIF_INTROUVABLE');
    });

    it('commande d’un autre utilisateur : 404 en lecture, paiements et remboursement', async () => {
      visiteur2 = await Client.anonymous(app);
      await visiteur2.post('/auth/register', { email: email('visiteur2'), password: TEST_PASSWORD, prenom: 'V', nom: 'Deux' });
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
      const achat = await visiteur2.post('/tickets/purchase', { tarifId: fx.tarifQuota5, quantite: 1 });
      expect(achat.statusCode).toBe(201);
      const id = achat.json().commandeId;
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
      const achat = await visiteur.post('/tickets/purchase', { tarifId: fx.tarifAttente, quantite: 1 });
      expect(achat.statusCode).toBe(201);
      commande = achat.json().commandeId;

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

      const achat = await visiteur.post('/tickets/purchase', { tarifId: fx.tarifAttente, quantite: 1 });
      expect(achat.statusCode).toBe(409);
      expect(achat.json().error).toBe('QUOTA_EPUISE');
      expect((await attente2.post(`/waitlist/${entree1}/confirm`)).statusCode).toBe(403);
    });

    it('offre refusée → passe au suivant, qui confirme et obtient son billet', async () => {
      expect((await attente1.delete(`/waitlist/${entree1}`)).statusCode).toBe(204);
      expect(await mine(attente1, entree1)).toMatchObject({ statut: 'annulee' });
      expect(await mine(attente2, entree2)).toMatchObject({ statut: 'notifiee' });

      const res = await attente2.post(`/waitlist/${entree2}/confirm`);
      expect(res.statusCode).toBe(200);
      expect(res.json().billetIds).toHaveLength(1);
      expect(await mine(attente2, entree2)).toMatchObject({ statut: 'confirmee' });

      const again = await attente2.post(`/waitlist/${entree2}/confirm`);
      expect(again.statusCode).toBe(409);
      expect(again.json().error).toBe('OFFRE_INACTIVE');
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
      const achat = await visiteur.post('/tickets/purchase', { tarifId: fx.tarifCheckin, quantite: 2 });
      expect(achat.statusCode).toBe(201);
      const ids: number[] = achat.json().billetIds;
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

      expect((await visiteur.post('/tickets/purchase', { tarifId: fx.tarifLive, quantite: 2 })).statusCode).toBe(201);
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
      const achat = await visiteur.post('/tickets/purchase', { tarifId: fx.tarifQuota5, quantite: 1 });
      expect(achat.statusCode).toBe(201);
      const [row] = await owner.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM emails_sortants
        WHERE type = 'commande_confirmee' AND commande_id = ${achat.json().commandeId}::bigint AND statut = 'a_envoyer'`;
      expect(Number(row?.n)).toBe(1);
    });

    it('annulation self-service : date limite exposée, refusée après le délai (409)', async () => {
      const achat = await visiteur.post('/tickets/purchase', { tarifId: fx.tarifProche, quantite: 1 });
      expect(achat.statusCode).toBe(201);
      const id = achat.json().commandeId;

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
      const achat = await visiteur.post('/tickets/purchase', { tarifId: fx.tarifProche, quantite: 1 });
      expect((await visiteur.post(`/orders/${achat.json().commandeId}/refund`)).statusCode).toBe(200);
    });

    it('export CSV des participants : en-têtes, un billet par ligne, accès restreint', async () => {
      const res = await orgaA.get(`/events/${fx.eventProche}/participants/export`);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/^text\/csv; charset=utf-8/);
      expect(res.headers['content-disposition']).toBe(`attachment; filename="participants-e2e-proche-${RUN}.csv"`);
      const lines = res.body.replace(/^\uFEFF/, '').trimEnd().split('\r\n');
      expect(lines[0]).toBe('billet;code;tarif;prix_paye;prenom;nom;commande;statut_commande;achete_le;scanne;scanne_le');

      const [base] = await owner.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM billets b JOIN tarifs t ON t.id = b.tarif_id WHERE t.evenement_id = ${fx.eventProche}`;
      expect(lines).toHaveLength(Number(base?.n) + 1);
      expect(lines.slice(1).every((l) => l.split(';').length === 11)).toBe(true);
      expect(lines.slice(1).map((l) => l.split(';')[7])).toEqual(expect.arrayContaining(['refunded']));

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
        expect.objectContaining({ action: 'UPDATE', ancienPrix: '30.00', nouveauPrix: '35.50', auteur: 'demo-organisateur@billetto.test' }),
      );
      expect((await orgaA.get('/analytics/price-audit')).statusCode).toBe(403);
    });

    it('utilisateurs : e-mails visibles de l’admin seulement', async () => {
      const res = await admin.get(`/users?q=${encodeURIComponent('demo-')}`);
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
  describe('concurrence', () => {
    it('30 achats simultanés sur un quota de 10 → exactement 10 ventes', async () => {
      const results = await Promise.all(
        Array.from({ length: 30 }, () => visiteur.post('/tickets/purchase', { tarifId: fx.tarifConcurrence, quantite: 1 })),
      );
      const statuses = results.map((r) => r.statusCode);
      expect(statuses.filter((s) => s === 201)).toHaveLength(10);
      expect(statuses.filter((s) => s === 409)).toHaveLength(20);
      expect(results.filter((r) => r.statusCode === 409).every((r) => r.json().error === 'QUOTA_EPUISE')).toBe(true);

      const [{ vendus }] = await owner.$queryRaw<{ vendus: bigint }[]>`
        SELECT count(*) AS vendus FROM billets WHERE tarif_id = ${fx.tarifConcurrence}`;
      expect(Number(vendus)).toBe(10);
    });
  });
});
