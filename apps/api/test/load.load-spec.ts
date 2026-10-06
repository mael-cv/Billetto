import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { cleanFixtures, createFixtures, email, type Fixtures } from './fixtures';
import { Client, DEMO_PASSWORD, owner, startApp, TEST_PASSWORD } from './support';

/**
 * Scénario de charge combiné sur un tarif en forte contention, via l'API
 * complète (HTTP → NestJS → PostgreSQL en billetto_app, RLS et fonctions) :
 *   1. N holds simultanés pour QUOTA places ;
 *   2. confirmations concurrentes (chaque hold confirmé 3 fois en parallèle) ;
 *   3. inscriptions simultanées en liste d'attente ;
 *   4. désistements (remboursements) concurrents + offres non honorées
 *      (expiration forcée) + balayage, comme le job ;
 *   5. réponses aux offres pendant que d'autres tentent d'acheter.
 * Après chaque vague : jamais vendus + holds actifs > QUOTA. À la fin : quota
 * exactement rempli, FIFO respecté, dashboard et outbox cohérents avec la base.
 *
 * Pas de webhook de paiement : la Phase 11 n'est pas implémentée (voir todo).
 * Taille réglable : LOAD_USERS (défaut 60, minimum 50).
 */
const QUOTA = 10;
const USERS = Math.max(50, Number(process.env.LOAD_USERS ?? 60));
const WAITLIST = 30;
const REFUNDS = 5;
const IGNORED_OFFERS = 2;

describe(`Charge combinée (${USERS} acheteurs, quota ${QUOTA})`, () => {
  let app: NestFastifyApplication;
  let fx: Fixtures;
  let tarif: number;
  let orga: Client;
  let users: Client[] = [];
  const holds = new Map<number, number>(); // index utilisateur → réservation
  const orders = new Map<number, number>(); // index utilisateur → commande
  const entries = new Map<number, number>(); // index utilisateur → inscription liste d'attente

  /** Places prises à l'instant : billets payés + holds actifs non expirés (règle de places_occupees). */
  const occupied = async () => {
    const [row] = await owner.$queryRaw<{ vendus: bigint; holds: bigint }[]>`
      SELECT (SELECT count(*) FROM billets b JOIN commandes c ON c.id = b.commande_id
              WHERE b.tarif_id = ${tarif} AND c.statut IN ('paid', 'pending')) AS vendus,
             (SELECT coalesce(sum(quantite), 0) FROM reservations
              WHERE tarif_id = ${tarif} AND statut = 'active' AND expire_a > now()) AS holds`;
    return { vendus: Number(row?.vendus), holds: Number(row?.holds) };
  };
  const user = (i: number): Client => {
    const u = users[i];
    if (!u) throw new Error(`acheteur ${i} inconnu`);
    return u;
  };
  const expectNoOversell = async () => {
    const { vendus, holds: h } = await occupied();
    expect(vendus + h).toBeLessThanOrEqual(QUOTA);
  };

  beforeAll(async () => {
    fx = await createFixtures();
    app = await startApp();
    const [row] = await owner.$queryRaw<{ id: bigint }[]>`
      INSERT INTO tarifs (evenement_id, nom, prix, quota, date_debut_vente, date_fin_vente)
      VALUES (${fx.eventFutur}, 'Charge', 30, ${QUOTA}, now() - interval '1 day', now() + interval '29 days')
      RETURNING id`;
    tarif = Number(row?.id);
    orga = await Client.login(app, 'demo-organisateur@billetto.test', DEMO_PASSWORD);

    // Inscriptions par lots (Argon2id est volontairement coûteux).
    for (let start = 0; start < USERS; start += 10) {
      const batch = await Promise.all(
        Array.from({ length: Math.min(10, USERS - start) }, async (_, k) => {
          const client = await Client.anonymous(app);
          const res = await client.post('/auth/register', {
            email: email(`charge-${start + k}`),
            password: TEST_PASSWORD,
            prenom: 'Charge',
            nom: String(start + k),
          });
          if (res.statusCode !== 201) throw new Error(`inscription ${start + k} : ${res.statusCode} ${res.body}`);
          return client;
        }),
      );
      users = users.concat(batch);
    }
  });

  afterAll(async () => {
    await app?.close();
    await cleanFixtures();
    await owner.$disconnect();
  });

  it(`1. ${USERS} holds simultanés → exactement ${QUOTA} acceptés`, async () => {
    const results = await Promise.all(
      users.map((u) => u.post('/orders/hold', { tarifId: tarif, quantite: 1, modePaiement: 'carte' })),
    );
    results.forEach((r, i) => {
      if (r.statusCode === 201) holds.set(i, r.json().id);
      else expect(r.json().error).toBe('QUOTA_EPUISE');
    });
    expect(holds.size).toBe(QUOTA);
    expect(await occupied()).toEqual({ vendus: 0, holds: QUOTA });
  });

  it('2. confirmations concurrentes (3 par hold) → une seule commande par réservation', async () => {
    const attempts = await Promise.all(
      [...holds].flatMap(([i, reservation]) =>
        [0, 1, 2].map(async () => ({ i, res: await user(i).post(`/orders/${reservation}/confirm`) })),
      ),
    );
    for (const { i, res } of attempts) {
      if (res.statusCode === 200) {
        expect(orders.has(i)).toBe(false); // jamais deux succès pour le même hold
        orders.set(i, res.json().commandeId);
      } else {
        expect(res.statusCode).toBe(409);
        expect(res.json().error).toBe('RESERVATION_NON_ACTIVE');
      }
    }
    expect(orders.size).toBe(QUOTA);
    const [dup] = await owner.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM reservations WHERE tarif_id = ${tarif} AND statut = 'confirmee' AND commande_id IS NOT NULL`;
    expect(Number(dup?.n)).toBe(QUOTA);
    expect(await occupied()).toEqual({ vendus: QUOTA, holds: 0 });
  });

  it(`3. ${WAITLIST} inscriptions simultanées en liste d'attente`, async () => {
    const candidates = users.map((_, i) => i).filter((i) => !holds.has(i)).slice(0, WAITLIST);
    const results = await Promise.all(
      candidates.map(async (i) => ({ i, res: await user(i).post('/waitlist', { tarifId: tarif, quantite: 1 }) })),
    );
    for (const { i, res } of results) {
      expect(res.statusCode).toBe(201);
      entries.set(i, res.json().id);
    }
    // Positions FIFO distinctes 1..N.
    const [positions] = await owner.$queryRaw<{ n: bigint; distinctes: bigint }[]>`
      SELECT count(*) AS n, count(DISTINCT position_liste_attente(id)) AS distinctes
      FROM liste_attente WHERE tarif_id = ${tarif} AND statut = 'en_attente'`;
    expect(Number(positions?.n)).toBe(WAITLIST);
    expect(Number(positions?.distinctes)).toBe(WAITLIST);
    await expectNoOversell();
  });

  it(`4. ${REFUNDS} désistements concurrents + ${IGNORED_OFFERS} offres ignorées → FIFO strict`, async () => {
    const refunders = [...orders].slice(0, REFUNDS);
    const refunds = await Promise.all(refunders.map(([i, cmd]) => user(i).post(`/orders/${cmd}/refund`)));
    refunds.forEach((r) => expect(r.statusCode).toBe(200));
    await expectNoOversell();

    // Les triggers ont offert exactement REFUNDS places aux REFUNDS premiers inscrits.
    const fifo = await owner.$queryRaw<{ id: bigint; statut: string }[]>`
      SELECT id, statut FROM liste_attente WHERE tarif_id = ${tarif} ORDER BY created_at, id`;
    expect(fifo.slice(0, REFUNDS).every((e) => e.statut === 'notifiee')).toBe(true);
    expect(fifo.slice(REFUNDS).every((e) => e.statut === 'en_attente')).toBe(true);
    expect(await occupied()).toEqual({ vendus: QUOTA - REFUNDS, holds: REFUNDS });

    // Deux offres non honorées : expiration (lazy) puis balayage du job.
    await owner.$executeRaw`
      UPDATE reservations SET expire_a = now() - interval '1 second'
      WHERE id IN (SELECT reservation_id FROM liste_attente WHERE id = ANY(${fifo.slice(0, IGNORED_OFFERS).map((e) => e.id)}::bigint[]))`;
    await owner.$queryRaw`SELECT traiter_listes_attente()`;

    const after = await owner.$queryRaw<{ statut: string }[]>`
      SELECT statut FROM liste_attente WHERE tarif_id = ${tarif} ORDER BY created_at, id`;
    const notified = REFUNDS + IGNORED_OFFERS;
    expect(after.slice(0, IGNORED_OFFERS).map((e) => e.statut)).toEqual(Array(IGNORED_OFFERS).fill('expiree'));
    expect(after.slice(IGNORED_OFFERS, notified).every((e) => e.statut === 'notifiee')).toBe(true);
    expect(after.slice(notified).every((e) => e.statut === 'en_attente')).toBe(true);
    expect(await occupied()).toEqual({ vendus: QUOTA - REFUNDS, holds: REFUNDS });
  });

  it('5. réponses aux offres pendant des tentatives d’achat direct → aucune place volée', async () => {
    const offers = await owner.$queryRaw<{ id: bigint; utilisateur_id: bigint }[]>`
      SELECT id, utilisateur_id FROM liste_attente WHERE tarif_id = ${tarif} AND statut = 'notifiee'`;
    const userIdOf = new Map<number, number>();
    const ids = await owner.$queryRaw<{ id: bigint; email: string }[]>`
      SELECT id, email FROM utilisateurs WHERE email LIKE ${email('charge-%')}`;
    for (const u of ids) userIdOf.set(Number(u.id), Number(/charge-(\d+)-/.exec(u.email)?.[1]));

    const buyers = users.map((_, i) => i).filter((i) => !holds.has(i) && !entries.has(i));
    const [confirms, purchases] = await Promise.all([
      Promise.all(
        offers.map((o) => user(userIdOf.get(Number(o.utilisateur_id)) ?? -1).post(`/waitlist/${o.id}/confirm`)),
      ),
      Promise.all(buyers.map((i) => user(i).post('/tickets/purchase', { tarifId: tarif, quantite: 1 }))),
    ]);
    confirms.forEach((r) => expect(r.statusCode).toBe(200));
    purchases.forEach((r) => {
      expect(r.statusCode).toBe(409);
      expect(r.json().error).toBe('QUOTA_EPUISE');
    });
    expect(await occupied()).toEqual({ vendus: QUOTA, holds: 0 });
  });

  it('invariants finaux : quota exact, dashboard et outbox cohérents avec la base', async () => {
    const [base] = await owner.$queryRaw<
      { vendus_evt: bigint; commandes_payees: bigint; emails_cmd: bigint; offres: bigint; emails_offre: bigint }[]
    >`
      SELECT (SELECT count(*) FROM billets b JOIN commandes c ON c.id = b.commande_id JOIN tarifs t ON t.id = b.tarif_id
              WHERE t.evenement_id = ${fx.eventFutur} AND c.statut = 'paid') AS vendus_evt,
             (SELECT count(DISTINCT c.id) FROM commandes c JOIN billets b ON b.commande_id = c.id
              WHERE b.tarif_id = ${tarif}) AS commandes_payees,
             (SELECT count(*) FROM emails_sortants e WHERE e.type = 'commande_confirmee'
              AND e.commande_id IN (SELECT b.commande_id FROM billets b WHERE b.tarif_id = ${tarif})) AS emails_cmd,
             (SELECT count(*) FROM liste_attente WHERE tarif_id = ${tarif} AND notifie_a IS NOT NULL) AS offres,
             (SELECT count(*) FROM emails_sortants e WHERE e.type = 'offre_liste_attente'
              AND e.liste_attente_id IN (SELECT id FROM liste_attente WHERE tarif_id = ${tarif})) AS emails_offre`;

    // Dashboard temps réel (organisateur, sous RLS) = comptes directs en base.
    const live = (await orga.get('/analytics/live')).json();
    const evt = live.evenements.find((e: { evenementId: number }) => e.evenementId === fx.eventFutur);
    expect(evt.vendus).toBe(Number(base?.vendus_evt));

    // Un e-mail par commande ayant été payée (y compris remboursées), un par offre.
    expect(Number(base?.emails_cmd)).toBe(Number(base?.commandes_payees));
    expect(Number(base?.commandes_payees)).toBe(QUOTA + REFUNDS);
    expect(Number(base?.offres)).toBe(REFUNDS + IGNORED_OFFERS);
    expect(Number(base?.emails_offre)).toBe(REFUNDS + IGNORED_OFFERS);
  });
});
