import { argon2, owner, RUN, TEST_PASSWORD } from './support';

export interface Fixtures {
  orgaA: number;
  orgaB: number;
  userOrgaB: string;
  eventFutur: number;
  tarifQuota5: number;
  tarifConcurrence: number;
  eventCommence: number;
  tarifCommence: number;
  eventDraftB: number;
  eventDraftBSlug: string;
}

const email = (name: string) => `e2e-${name}-${RUN}@billetto.test`;
export { email };

/** Données de test isolées par RUN, créées avec la connexion propriétaire. */
export async function createFixtures(): Promise<Fixtures> {
  const [{ id: orgaA }] = await owner.$queryRaw<{ id: bigint }[]>`
    SELECT organisateur_id AS id FROM utilisateurs WHERE email = 'demo-organisateur@billetto.test'`;
  const [{ id: orgaB }] = await owner.$queryRaw<{ id: bigint }[]>`
    SELECT min(id) AS id FROM organisateurs WHERE id <> ${orgaA}`;
  const [{ lieu, type }] = await owner.$queryRaw<{ lieu: bigint; type: bigint }[]>`
    SELECT (SELECT min(id) FROM lieux) AS lieu, (SELECT id FROM type_evenements WHERE nom = 'Rock') AS type`;

  const userOrgaB = email('orga-b');
  await owner.$executeRaw`
    INSERT INTO utilisateurs (email, password_hash, prenom, nom, role_app, organisateur_id)
    VALUES (${userOrgaB}, ${await argon2(TEST_PASSWORD)}, 'Orga', 'B', 'organizer', ${orgaB})`;

  const event = async (organisateur: bigint, slug: string, debut: string, statut: string) => {
    const [row] = await owner.$queryRaw<{ id: bigint }[]>`
      INSERT INTO evenements (organisateur_id, lieu_id, type_evenement_id, nom, slug, debut, fin, statut)
      VALUES (${organisateur}, ${lieu}, ${type}, ${`E2E ${slug}`}, ${`${slug}-${RUN}`},
              now() + ${debut}::interval, now() + ${debut}::interval + interval '3 hours', ${statut})
      RETURNING id`;
    if (!row) throw new Error('insertion evenement');
    return row.id;
  };
  const tarif = async (evenement: bigint, nom: string, quota: number, debutVente: string, finVente: string) => {
    const [row] = await owner.$queryRaw<{ id: bigint }[]>`
      INSERT INTO tarifs (evenement_id, nom, prix, quota, date_debut_vente, date_fin_vente)
      VALUES (${evenement}, ${nom}, 25, ${quota}, now() + ${debutVente}::interval, now() + ${finVente}::interval)
      RETURNING id`;
    if (!row) throw new Error('insertion tarif');
    return row.id;
  };

  const eventFutur = await event(orgaA, 'e2e-futur', '30 days', 'published');
  const tarifQuota5 = await tarif(eventFutur, 'Quota 5', 5, '-1 day', '29 days');
  const tarifConcurrence = await tarif(eventFutur, 'Concurrence', 10, '-1 day', '29 days');
  const eventCommence = await event(orgaA, 'e2e-commence', '-1 hour', 'published');
  const tarifCommence = await tarif(eventCommence, 'Standard', 50, '-10 days', '-2 hours');
  const eventDraftB = await event(orgaB, 'e2e-brouillon-b', '40 days', 'draft');

  return {
    orgaA: Number(orgaA),
    orgaB: Number(orgaB),
    userOrgaB,
    eventFutur: Number(eventFutur),
    tarifQuota5: Number(tarifQuota5),
    tarifConcurrence: Number(tarifConcurrence),
    eventCommence: Number(eventCommence),
    tarifCommence: Number(tarifCommence),
    eventDraftB: Number(eventDraftB),
    eventDraftBSlug: `e2e-brouillon-b-${RUN}`,
  };
}

/** Supprime tout ce qui a été créé pendant l'exécution (utilisateurs, achats, événements). */
export async function cleanFixtures(): Promise<void> {
  const users = await owner.$queryRaw<{ id: bigint }[]>`
    SELECT id FROM utilisateurs WHERE email LIKE ${`e2e-%-${RUN}@billetto.test`}`;
  const events = await owner.$queryRaw<{ id: bigint }[]>`
    SELECT id FROM evenements WHERE slug LIKE ${`%-${RUN}`}`;
  const userIds = users.map((u) => u.id);
  const eventIds = events.map((e) => e.id);

  await owner.$transaction(async (tx) => {
    // Commandes des utilisateurs de test ET commandes (ex. comptes démo) sur les événements de test.
    const orders = await tx.$queryRaw<{ id: bigint }[]>`
      SELECT DISTINCT c.id FROM commandes c
      LEFT JOIN billets b ON b.commande_id = c.id
      LEFT JOIN tarifs t  ON t.id = b.tarif_id
      WHERE c.utilisateur_id = ANY(${userIds}::bigint[]) OR t.evenement_id = ANY(${eventIds}::bigint[])`;
    const orderIds = orders.map((o) => o.id);
    await tx.$executeRaw`DELETE FROM paiements WHERE commande_id = ANY(${orderIds}::bigint[])`;
    await tx.$executeRaw`DELETE FROM billets WHERE commande_id = ANY(${orderIds}::bigint[])`;
    await tx.$executeRaw`DELETE FROM commandes WHERE id = ANY(${orderIds}::bigint[])`;
    await tx.$executeRaw`
      DELETE FROM journal_tarifs WHERE tarif_id IN (SELECT id FROM tarifs WHERE evenement_id = ANY(${eventIds}::bigint[]))`;
    await tx.$executeRaw`DELETE FROM evenement_attributs WHERE evenement_id = ANY(${eventIds}::bigint[])`;
    await tx.$executeRaw`DELETE FROM tarifs WHERE evenement_id = ANY(${eventIds}::bigint[])`;
    await tx.$executeRaw`DELETE FROM evenements WHERE id = ANY(${eventIds}::bigint[])`;
    await tx.$executeRaw`DELETE FROM utilisateurs WHERE id = ANY(${userIds}::bigint[])`;
  });
}
