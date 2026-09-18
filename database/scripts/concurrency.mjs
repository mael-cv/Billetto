// Test de concurrence : N sessions PostgreSQL achètent en même temps 1 billet
// d'un tarif dont le quota est Q (< N).
//
//   1. acheter_billet()          -> verrou FOR UPDATE : exactement Q ventes.
//   2. demo_concurrence.acheter_naif() -> contrôle puis insertion SANS verrou :
//      les sessions lisent toutes « places disponibles » avant que les autres
//      n'insèrent -> survente (démonstration du problème).
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
             FROM e, (VALUES ('Verrou'), ('Naif')) v(nom) RETURNING id, nom)
  SELECT (SELECT id FROM u) || ' ' || (SELECT id FROM e) || ' ' || (SELECT id FROM o) || ' ' ||
         (SELECT id FROM l) || ' ' || (SELECT id FROM t WHERE nom = 'Verrou') || ' ' || (SELECT id FROM t WHERE nom = 'Naif')
`);
const [user, evt, orga, lieu, tVerrou, tNaif] = setup.split(/\s+/).map(Number);

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

  const checks = [
    [avecVerrou.other.length === 0, `erreurs inattendues : ${avecVerrou.other.join(' | ')}`],
    [avecVerrou.ok === QUOTA, `acheter_billet : ${QUOTA} succès attendus, ${avecVerrou.ok}`],
    [avecVerrou.quota === N - QUOTA, `acheter_billet : ${N - QUOTA} refus attendus, ${avecVerrou.quota}`],
    [vendusVerrou === QUOTA, `acheter_billet : ${QUOTA} billets attendus en base, ${vendusVerrou}`],
    [vendusNaif > QUOTA, `démonstration : la version naïve devait survendre (${vendusNaif} billets)`],
  ];
  for (const [ok, msg] of checks) {
    if (!ok) {
      console.error(`✗ ${msg}`);
      failed = true;
    }
  }
  if (!failed) {
    console.log(`✓ aucune survente avec verrou ; survente reproduite sans verrou (${vendusNaif}/${QUOTA})`);
  }
} finally {
  q(`
    DELETE FROM paiements WHERE commande_id IN (SELECT id FROM commandes WHERE utilisateur_id = ${user});
    DELETE FROM billets WHERE utilisateur_id = ${user};
    DELETE FROM commandes WHERE utilisateur_id = ${user};
    DELETE FROM tarifs WHERE evenement_id = ${evt};
    DELETE FROM journal_tarifs WHERE tarif_id IN (${tVerrou}, ${tNaif});
    DELETE FROM evenements WHERE id = ${evt};
    DELETE FROM lieux WHERE id = ${lieu};
    DELETE FROM utilisateurs WHERE id = ${user};
    DELETE FROM organisateurs WHERE id = ${orga};
    DROP SCHEMA demo_concurrence CASCADE;
  `);
}
process.exit(failed ? 1 : 0);
