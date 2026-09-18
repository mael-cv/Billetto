// Test de concurrence : N sessions PostgreSQL achètent (ou réservent) en même
// temps 1 billet d'un tarif dont le quota est Q (< N).
//
//   1. acheter_billet()          -> verrou FOR UPDATE : exactement Q ventes.
//   2. demo_concurrence.acheter_naif() -> contrôle puis insertion SANS verrou :
//      les sessions lisent toutes « places disponibles » avant que les autres
//      n'insèrent -> survente (démonstration du problème).
//   3. creer_reservation()       -> même verrou FOR UPDATE, phase 10 : exactement
//      Q holds actifs, zéro survente sur les réservations concurrentes.
//   4. Un hold expiré (p_ttl_override) ne doit plus compter dans le quota :
//      testé séquentiellement (pas besoin de concurrence), via pg_sleep.
//
// Les sessions sont lancées en parallèle DANS le conteneur (psql en arrière-plan)
// pour éviter le délai de démarrage de docker exec. Les données de test sont
// validées (nécessaire pour être vues par les autres sessions) puis supprimées.
import { spawnSync } from 'node:child_process';
import { psql } from './psql.mjs';

const N = Number(process.env.CONCURRENCY_SESSIONS ?? 40);
const QUOTA = 10;
const q = (sql) => psql(['-At', '-c', sql], { capture: true }).trim();

function parallel(sqlTemplate) {
  const script = `
    for i in $(seq 1 ${N}); do
      psql -X -q -At -v VERBOSITY=verbose -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
           -c "${sqlTemplate}" > /tmp/conc_$i.log 2>&1 &
    done
    wait
    cat /tmp/conc_*.log; rm -f /tmp/conc_*.log`;
  const res = spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', script], {
    encoding: 'utf-8',
  });
  const out = res.stdout ?? '';
  return {
    ok: out.split('\n').filter((l) => /^\d+$/.test(l.trim())).length,
    quota: (out.match(/BT006/g) ?? []).length,
    other: out.split('\n').filter((l) => /ERROR/.test(l) && !/BT006/.test(l)),
  };
}

const setup = q(`
  WITH o AS (INSERT INTO organisateurs (nom, email, slug)
             VALUES ('Concurrence', 'concurrence-' || txid_current() || '@billetto.test', 'concurrence-' || txid_current()) RETURNING id),
       l AS (INSERT INTO lieux (nom, adresse, ville, code_postal, capacite)
             VALUES ('Salle concurrence ' || txid_current(), '1 rue', 'Testville', '99000', 100) RETURNING id),
       u AS (INSERT INTO utilisateurs (email, password_hash, prenom, nom)
             VALUES ('concurrence-' || txid_current() || '@billetto.test', 'x', 'Test', 'Concurrence') RETURNING id),
       e AS (INSERT INTO evenements (organisateur_id, lieu_id, type_evenement_id, nom, slug, debut, fin, statut)
             SELECT o.id, l.id, (SELECT min(id) FROM type_evenements), 'Concurrence',
                    'concurrence-' || txid_current(), now() + interval '30 days', now() + interval '31 days', 'published'
             FROM o, l RETURNING id, organisateur_id, lieu_id),
       t AS (INSERT INTO tarifs (evenement_id, nom, prix, quota, date_debut_vente, date_fin_vente)
             SELECT e.id, v.nom, 20, ${QUOTA}, now() - interval '1 day', now() + interval '29 days'
             FROM e, (VALUES ('Verrou'), ('Naif'), ('Hold'), ('Expiry')) v(nom) RETURNING id, nom)
  SELECT (SELECT id FROM u) || ' ' || (SELECT id FROM e) || ' ' || (SELECT id FROM o) || ' ' ||
         (SELECT id FROM l) || ' ' || (SELECT id FROM t WHERE nom = 'Verrou') || ' ' || (SELECT id FROM t WHERE nom = 'Naif') || ' ' ||
         (SELECT id FROM t WHERE nom = 'Hold') || ' ' || (SELECT id FROM t WHERE nom = 'Expiry')
`);
const [user, evt, orga, lieu, tVerrou, tNaif, tHold, tExpiry] = setup.split(/\s+/).map(Number);

q(`
  CREATE SCHEMA IF NOT EXISTS demo_concurrence;
  CREATE OR REPLACE FUNCTION demo_concurrence.acheter_naif(p_user bigint, p_tarif bigint)
  RETURNS bigint LANGUAGE plpgsql AS $f$
  DECLARE v_quota int; v_vendus bigint; v_cmd bigint;
  BEGIN
      SELECT quota INTO v_quota FROM public.tarifs WHERE id = p_tarif;          -- pas de FOR UPDATE
      SELECT count(*) INTO v_vendus FROM public.billets WHERE tarif_id = p_tarif;
      IF v_vendus >= v_quota THEN
          RAISE EXCEPTION 'quota épuisé' USING ERRCODE = 'BT006';
      END IF;
      PERFORM pg_sleep(0.2);  -- élargit la fenêtre entre le contrôle et l'écriture
      INSERT INTO public.commandes (utilisateur_id, statut, montant_total) VALUES (p_user, 'paid', 20)
      RETURNING id INTO v_cmd;
      INSERT INTO public.billets (tarif_id, commande_id, utilisateur_id, prix_paye) VALUES (p_tarif, v_cmd, p_user, 20);
      RETURN v_cmd;
  END $f$;
`);

let failed = false;
try {
  console.log(`» ${N} sessions simultanées, quota ${QUOTA}`);

  const avecVerrou = parallel(`SELECT commande_id FROM acheter_billet(${user}, ${tVerrou}, 1)`);
  const vendusVerrou = Number(q(`SELECT count(*) FROM billets WHERE tarif_id = ${tVerrou}`));
  console.log(
    `  acheter_billet (FOR UPDATE) : ${avecVerrou.ok} succès, ${avecVerrou.quota} refus BT006, ${vendusVerrou} billets en base`,
  );

  const naif = parallel(`SELECT demo_concurrence.acheter_naif(${user}, ${tNaif})`);
  const vendusNaif = Number(q(`SELECT count(*) FROM billets WHERE tarif_id = ${tNaif}`));
  console.log(
    `  version naïve (sans verrou)  : ${naif.ok} succès, ${naif.quota} refus BT006, ${vendusNaif} billets en base`,
  );

  console.log(`» phase 10 : ${N} holds simultanés, quota ${QUOTA}`);
  const holds = parallel(`SELECT reservation_id FROM creer_reservation(${user}, ${tHold}, 1, 'carte')`);
  const reservesHold = Number(
    q(`SELECT count(*) FROM reservations WHERE tarif_id = ${tHold} AND statut = 'active' AND expire_a > now()`),
  );
  console.log(
    `  creer_reservation (FOR UPDATE) : ${holds.ok} succès, ${holds.quota} refus BT006, ${reservesHold} réservations actives en base`,
  );

  // Un hold expiré ne doit plus bloquer le quota : QUOTA holds à TTL 1s,
  // on attend l'expiration, puis un nouveau hold sur les mêmes places doit
  // réussir sans dépendre d'un job de purge (expiration lazy).
  for (let i = 0; i < QUOTA; i++) {
    q(`SELECT reservation_id FROM creer_reservation(${user}, ${tExpiry}, 1, 'carte', interval '1 second')`);
  }
  q(`SELECT pg_sleep(1.5)`);
  let expiryFreed = false;
  let expiryError = '';
  try {
    q(`SELECT reservation_id FROM creer_reservation(${user}, ${tExpiry}, ${QUOTA}, 'carte')`);
    expiryFreed = true;
  } catch (err) {
    expiryError = String(err);
  }
  console.log(`  hold expiré libère le quota : ${expiryFreed ? 'OK' : `ÉCHEC (${expiryError})`}`);

  const checks = [
    [avecVerrou.other.length === 0, `erreurs inattendues : ${avecVerrou.other.join(' | ')}`],
    [avecVerrou.ok === QUOTA, `acheter_billet : ${QUOTA} succès attendus, ${avecVerrou.ok}`],
    [avecVerrou.quota === N - QUOTA, `acheter_billet : ${N - QUOTA} refus attendus, ${avecVerrou.quota}`],
    [vendusVerrou === QUOTA, `acheter_billet : ${QUOTA} billets attendus en base, ${vendusVerrou}`],
    [vendusNaif > QUOTA, `démonstration : la version naïve devait survendre (${vendusNaif} billets)`],
    [holds.other.length === 0, `creer_reservation : erreurs inattendues : ${holds.other.join(' | ')}`],
    [holds.ok === QUOTA, `creer_reservation : ${QUOTA} succès attendus, ${holds.ok}`],
    [holds.quota === N - QUOTA, `creer_reservation : ${N - QUOTA} refus attendus, ${holds.quota}`],
    [reservesHold === QUOTA, `creer_reservation : ${QUOTA} réservations actives attendues en base, ${reservesHold}`],
    [expiryFreed, `un hold expiré doit libérer le quota sans dépendre de la purge (${expiryError})`],
  ];
  for (const [ok, msg] of checks) {
    if (!ok) {
      console.error(`✗ ${msg}`);
      failed = true;
    }
  }
  if (!failed) {
    console.log(`✓ aucune survente avec verrou ; survente reproduite sans verrou (${vendusNaif}/${QUOTA})`);
    console.log(`✓ aucune survente sur les holds concurrents ; hold expiré libère le quota (expiration lazy)`);
  }
} finally {
  q(`
    DELETE FROM paiements WHERE commande_id IN (SELECT id FROM commandes WHERE utilisateur_id = ${user});
    DELETE FROM billets WHERE utilisateur_id = ${user};
    DELETE FROM reservations WHERE utilisateur_id = ${user};
    DELETE FROM commandes WHERE utilisateur_id = ${user};
    DELETE FROM tarifs WHERE evenement_id = ${evt};
    DELETE FROM journal_tarifs WHERE tarif_id IN (${tVerrou}, ${tNaif}, ${tHold}, ${tExpiry});
    DELETE FROM evenements WHERE id = ${evt};
    DELETE FROM lieux WHERE id = ${lieu};
    DELETE FROM utilisateurs WHERE id = ${user};
    DELETE FROM organisateurs WHERE id = ${orga};
    DROP SCHEMA demo_concurrence CASCADE;
  `);
}
process.exit(failed ? 1 : 0);
