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
//   5. acheter_billet() sur un tarif entièrement réservé (holds actifs) : N
//      achats simultanés, zéro succès (quota unifié, migration 009).
//   6. Un hold expiré ne bloque plus acheter_billet() non plus.
//   7. purger_reservations_expirees() marque les holds expirés sans toucher
//      les holds actifs (reporting uniquement).
//   8. Phase 12 : une place se libère (hold expiré, aucun événement) et N
//      sessions appellent traiter_liste_attente en même temps : une seule
//      offre, pour la tête de file (FIFO strict).
//   9. Phase 13 : N sessions scannent le même billet (client_scan_id
//      distincts) → exactement 1 'ok' ; N sessions rejouent le même
//      client_scan_id → 1 seule ligne.
//  10. Phase 14 : pendant que N sessions achètent et réservent sur un même
//      événement, une session lit en boucle v_remplissage (dashboard live) :
//      jamais vendus + réservés > places, et chiffres finaux = comptes directs.
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

// Écritures concurrentes + lecteur en boucle, dans le même conteneur.
function parallelWithReader(writeSql, readSql, reads) {
  const script = `
    for i in $(seq 1 ${N}); do
      if [ $((i % 2)) -eq 0 ]; then SQL="${writeSql.even}"; else SQL="${writeSql.odd}"; fi
      psql -X -q -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$SQL" > /tmp/w_$i.log 2>&1 &
    done
    for r in $(seq 1 ${reads}); do
      psql -X -q -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "${readSql}"
    done
    wait
    cat /tmp/w_*.log; rm -f /tmp/w_*.log`;
  const res = spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', script], { encoding: 'utf-8' });
  return res.stdout ?? '';
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
             FROM e, (VALUES ('Verrou'), ('Naif'), ('Hold'), ('Expiry'), ('ExpiryBuy')) v(nom) RETURNING id, nom)
  SELECT (SELECT id FROM u) || ' ' || (SELECT id FROM e) || ' ' || (SELECT id FROM o) || ' ' ||
         (SELECT id FROM l) || ' ' || (SELECT id FROM t WHERE nom = 'Verrou') || ' ' || (SELECT id FROM t WHERE nom = 'Naif') || ' ' ||
         (SELECT id FROM t WHERE nom = 'Hold') || ' ' || (SELECT id FROM t WHERE nom = 'Expiry') || ' ' ||
         (SELECT id FROM t WHERE nom = 'ExpiryBuy')
`);
const [user, evt, orga, lieu, tVerrou, tNaif, tHold, tExpiry, tExpiryBuy] = setup.split(/\s+/).map(Number);

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
let tAttente = 0;
let evtLive = 0;
let tLive = 0;
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
    q(`SELECT reservation_id FROM creer_reservation(${user}, ${tExpiryBuy}, 1, 'carte', interval '1 second')`);
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

  let expiryBuyFreed = false;
  let expiryBuyError = '';
  try {
    q(`SELECT commande_id FROM acheter_billet(${user}, ${tExpiryBuy}, ${QUOTA})`);
    expiryBuyFreed = true;
  } catch (err) {
    expiryBuyError = String(err);
  }
  console.log(`  hold expiré libère le quota (acheter_billet) : ${expiryBuyFreed ? 'OK' : `ÉCHEC (${expiryBuyError})`}`);

  // Quota de tHold entièrement pris par les holds actifs du test 3 : aucun
  // achat direct ne doit passer.
  console.log(`» phase 10 : ${N} achats simultanés sur un tarif entièrement réservé`);
  const surReserve = parallel(`SELECT commande_id FROM acheter_billet(${user}, ${tHold}, 1)`);
  const vendusHold = Number(q(`SELECT count(*) FROM billets WHERE tarif_id = ${tHold}`));
  const restantsHold = Number(q(`SELECT places_restantes(${tHold})`));
  console.log(
    `  acheter_billet sur holds actifs : ${surReserve.ok} succès, ${surReserve.quota} refus BT006, ${vendusHold} billets, ${restantsHold} places restantes`,
  );

  // tExpiry : QUOTA holds expirés + 1 hold actif de QUOTA places.
  q(`CALL purger_reservations_expirees()`);
  const [expirees, actives] = q(
    `SELECT count(*) FILTER (WHERE statut = 'expiree') || ' ' || count(*) FILTER (WHERE statut = 'active')
     FROM reservations WHERE tarif_id = ${tExpiry}`,
  )
    .split(/\s+/)
    .map(Number);
  console.log(`  purge : ${expirees} holds marqués expirés, ${actives} hold actif conservé`);

  // Quota pris par QUOTA-1 billets + 1 hold à TTL 1s ; 3 inscrits ; le hold
  // expire (lazy, aucun trigger) ; N balayages concurrents.
  console.log(`» phase 12 : ${N} traiter_liste_attente simultanés pour 1 place libérée`);
  tAttente = Number(
    q(`INSERT INTO tarifs (evenement_id, nom, prix, quota, date_debut_vente, date_fin_vente)
       VALUES (${evt}, 'Attente', 20, ${QUOTA}, now() - interval '1 day', now() + interval '29 days') RETURNING id`),
  );
  const attendants = q(`
    INSERT INTO utilisateurs (email, password_hash, prenom, nom)
    SELECT 'attente-conc-' || i || '-${evt}@billetto.test', 'x', 'Test', 'Attente ' || i FROM generate_series(1, 3) i
    RETURNING id`)
    .split(/\s+/)
    .map(Number);
  q(`SELECT commande_id FROM acheter_billet(${user}, ${tAttente}, ${QUOTA - 1})`);
  q(`SELECT reservation_id FROM creer_reservation(${user}, ${tAttente}, 1, 'carte', interval '1 second')`);
  for (const a of attendants) q(`SELECT inscrire_liste_attente(${a}, ${tAttente}, 1)`);
  q(`SELECT pg_sleep(1.5)`);
  const balayages = parallel(`SELECT traiter_liste_attente(${tAttente})`);
  const offres = q(
    `SELECT utilisateur_id FROM liste_attente WHERE tarif_id = ${tAttente} AND statut = 'notifiee' ORDER BY id`,
  )
    .split(/\s+/)
    .filter(Boolean)
    .map(Number);
  const restantsAttente = Number(q(`SELECT places_restantes(${tAttente})`));
  console.log(
    `  ${offres.length} offre(s) émise(s) (utilisateur ${offres.join(', ') || '-'}, tête = ${attendants[0]}), ${restantsAttente} place restante`,
  );

  console.log(`» phase 13 : ${N} scans simultanés du même billet`);
  const qr = q(`SELECT 'BT1.' || code || '.' || code_verification FROM billets WHERE tarif_id = ${tVerrou} ORDER BY id LIMIT 1`);
  const scans = parallel(`SELECT resultat FROM scanner_billet(gen_random_uuid(), '${qr}', ${evt})`);
  const [scansOk, scansDoublon] = q(
    `SELECT count(*) FILTER (WHERE resultat = 'ok') || ' ' || count(*) FILTER (WHERE resultat = 'doublon')
     FROM billets_scans WHERE evenement_id = ${evt}`,
  )
    .split(/\s+/)
    .map(Number);
  const rejeuId = q(`SELECT gen_random_uuid()`);
  const qr2 = q(`SELECT 'BT1.' || code || '.' || code_verification FROM billets WHERE tarif_id = ${tVerrou} ORDER BY id OFFSET 1 LIMIT 1`);
  const rejeux = parallel(`SELECT resultat FROM scanner_billet('${rejeuId}', '${qr2}', ${evt})`);
  const lignesRejeu = Number(q(`SELECT count(*) FROM billets_scans WHERE client_scan_id = '${rejeuId}'`));
  console.log(`  ${scansOk} ok, ${scansDoublon} doublon(s) ; même client_scan_id rejoué ${N} fois : ${lignesRejeu} ligne`);

  console.log(`» phase 14 : lectures du dashboard pendant ${N} achats/holds simultanés`);
  evtLive = Number(
    q(`INSERT INTO evenements (organisateur_id, lieu_id, type_evenement_id, nom, slug, debut, fin, statut)
       SELECT organisateur_id, lieu_id, type_evenement_id, 'Concurrence live', slug || '-live', debut, fin, 'published'
       FROM evenements WHERE id = ${evt} RETURNING id`),
  );
  tLive = Number(
    q(`INSERT INTO tarifs (evenement_id, nom, prix, quota, date_debut_vente, date_fin_vente)
       VALUES (${evtLive}, 'Live', 20, ${QUOTA}, now() - interval '1 day', now() + interval '29 days') RETURNING id`),
  );
  const liveOut = parallelWithReader(
    {
      even: `SELECT commande_id FROM acheter_billet(${user}, ${tLive}, 1)`,
      odd: `SELECT reservation_id FROM creer_reservation(${user}, ${tLive}, 1, 'carte')`,
    },
    `SELECT CASE WHEN billets_vendus + billets_reserves > places OR billets_vendus < 0 OR billets_reserves < 0
                 THEN 'VIOLATION ' || billets_vendus || '+' || billets_reserves || '>' || places ELSE 'LECTURE' END
     FROM v_remplissage WHERE evenement_id = ${evtLive}`,
    30,
  );
  const lectures = (liveOut.match(/^LECTURE$/gm) ?? []).length;
  const violations = liveOut.split('\n').filter((l) => l.startsWith('VIOLATION'));
  const [vueVendus, vueReserves, vraisVendus, vraisReserves] = q(`
    SELECT billets_vendus || ' ' || billets_reserves || ' ' ||
           (SELECT count(*) FROM billets b JOIN commandes c ON c.id = b.commande_id
            WHERE b.tarif_id = ${tLive} AND c.statut = 'paid') || ' ' ||
           (SELECT coalesce(sum(quantite), 0) FROM reservations
            WHERE tarif_id = ${tLive} AND statut = 'active' AND expire_a > now())
    FROM v_remplissage WHERE evenement_id = ${evtLive}`)
    .split(/\s+/)
    .map(Number);
  console.log(
    `  ${lectures} lectures, ${violations.length} incohérence(s) ; final : vue ${vueVendus} vendus + ${vueReserves} réservés, base ${vraisVendus} + ${vraisReserves}`,
  );

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
    [expiryBuyFreed, `un hold expiré doit libérer le quota pour acheter_billet (${expiryBuyError})`],
    [surReserve.other.length === 0, `acheter_billet sur holds : erreurs inattendues : ${surReserve.other.join(' | ')}`],
    [surReserve.ok === 0, `acheter_billet sur holds : 0 succès attendu, ${surReserve.ok}`],
    [surReserve.quota === N, `acheter_billet sur holds : ${N} refus attendus, ${surReserve.quota}`],
    [vendusHold === 0 && restantsHold === 0, `tarif réservé : 0 billet / 0 place restante attendus, ${vendusHold} / ${restantsHold}`],
    [balayages.other.length === 0, `traiter_liste_attente : erreurs inattendues : ${balayages.other.join(' | ')}`],
    [offres.length === 1 && offres[0] === attendants[0], `liste d'attente : 1 offre pour la tête attendue, ${offres.join(', ')}`],
    [restantsAttente === 0, `liste d'attente : la place offerte doit être bloquée, ${restantsAttente} restante(s)`],
    [scans.other.length === 0 && rejeux.other.length === 0, `scanner_billet : erreurs inattendues : ${[...scans.other, ...rejeux.other].join(' | ')}`],
    [scansOk === 1 && scansDoublon === N - 1, `check-in : 1 ok / ${N - 1} doublons attendus, ${scansOk} / ${scansDoublon}`],
    [lignesRejeu === 1, `check-in : 1 ligne attendue pour un client_scan_id rejoué, ${lignesRejeu}`],
    [lectures === 30 && violations.length === 0, `dashboard : 30 lectures cohérentes attendues, ${lectures} / ${violations.join(' | ')}`],
    [
      vueVendus === vraisVendus && vueReserves === vraisReserves && vueVendus + vueReserves === QUOTA,
      `dashboard : chiffres finaux ${vueVendus}+${vueReserves} ≠ base ${vraisVendus}+${vraisReserves} (quota ${QUOTA})`,
    ],
    [expirees === QUOTA && actives === 1, `purge : ${QUOTA} expirés / 1 actif attendus, ${expirees} / ${actives}`],
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
    console.log(`✓ achat direct bloqué par les holds actifs ; purge = reporting uniquement`);
    console.log(`✓ dashboard live : aucune lecture incohérente sous charge, chiffres finaux exacts`);
    console.log(`✓ check-in : un seul scan ok malgré ${N} scans simultanés ; rejeux idempotents`);
    console.log(`✓ liste d'attente : une seule offre, à la tête de file, malgré ${N} balayages concurrents`);
  }
} finally {
  q(`
    DELETE FROM billets_scans WHERE evenement_id = ${evt};
    DELETE FROM reservations WHERE tarif_id = ${tLive};
    DELETE FROM emails_sortants WHERE utilisateur_id = ${user}
       OR commande_id IN (SELECT id FROM commandes WHERE utilisateur_id = ${user})
       OR liste_attente_id IN (SELECT la.id FROM liste_attente la JOIN tarifs t ON t.id = la.tarif_id WHERE t.evenement_id = ${evt});
    DELETE FROM liste_attente WHERE tarif_id IN (SELECT id FROM tarifs WHERE evenement_id = ${evt});
    DELETE FROM reservations WHERE tarif_id IN (SELECT id FROM tarifs WHERE evenement_id = ${evt});
    DELETE FROM paiements WHERE commande_id IN (SELECT id FROM commandes WHERE utilisateur_id = ${user});
    DELETE FROM billets WHERE utilisateur_id = ${user};
    DELETE FROM reservations WHERE utilisateur_id = ${user};
    DELETE FROM commandes WHERE utilisateur_id = ${user};
    DELETE FROM tarifs WHERE evenement_id IN (${evt}, ${evtLive});
    DELETE FROM journal_tarifs WHERE tarif_id IN (${tVerrou}, ${tNaif}, ${tHold}, ${tExpiry}, ${tExpiryBuy}, ${tAttente}, ${tLive});
    DELETE FROM evenements WHERE id IN (${evt}, ${evtLive});
    DELETE FROM lieux WHERE id = ${lieu};
    DELETE FROM utilisateurs WHERE id = ${user} OR email LIKE 'attente-conc-%-${evt}@billetto.test';
    DELETE FROM organisateurs WHERE id = ${orga};
    DROP SCHEMA demo_concurrence CASCADE;
  `);
}
process.exit(failed ? 1 : 0);
