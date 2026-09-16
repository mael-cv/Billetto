// Tests de sécurité avec une VRAIE connexion billetto_app (mot de passe, TCP).
//
// Certains contrôles sont impossibles depuis une session superutilisateur :
//   - SET ROLE vérifie l'appartenance du rôle de SESSION, pas du rôle courant ;
//   - controler_acteur() autorise la maintenance sans contexte pour un superutilisateur.
// Ce script se connecte donc réellement comme l'API le fera.
import { spawnSync } from 'node:child_process';
import './psql.mjs'; // charge .env

const password = process.env.APP_DB_PASSWORD;
if (!password) {
  console.error('✗ APP_DB_PASSWORD absent : impossible de tester la connexion billetto_app');
  process.exit(1);
}

// Une invocation = une session. Les commandes sont envoyées sur l'entrée standard.
function asApp(sql) {
  const res = spawnSync(
    'docker',
    [
      'compose', 'exec', '-T', '-e', `PGPASSWORD=${password}`, 'postgres',
      'sh', '-c', 'psql -h 127.0.0.1 -U billetto_app -d "$POSTGRES_DB" -X -q -At -v VERBOSITY=verbose',
    ],
    { input: sql, encoding: 'utf-8' },
  );
  return `${res.stdout ?? ''}${res.stderr ?? ''}`;
}

const checks = [
  {
    label: 'connexion par mot de passe, rôle de session billetto_app',
    sql: 'SELECT session_user, current_user;',
    expect: /^billetto_app\|billetto_app$/m,
  },
  {
    label: 'aucune lecture sans SET ROLE',
    sql: 'SELECT count(*) FROM evenements;',
    expect: /42501: permission denied for table evenements/,
  },
  {
    label: 'impossible d’endosser billetto_readonly (non membre)',
    sql: 'SET ROLE billetto_readonly;',
    expect: /42501: permission denied to set role "billetto_readonly"/,
  },
  {
    label: 'impossible d’endosser le propriétaire du schéma',
    sql: `SET ROLE ${process.env.POSTGRES_USER ?? 'billetto_owner'};`,
    expect: /42501: permission denied to set role/,
  },
  {
    label: 'endosse visiteur, organisateur et admin',
    sql: `BEGIN;
SET LOCAL ROLE billetto_visiteur; SELECT current_user;
SET LOCAL ROLE billetto_organisateur; SELECT current_user;
SET LOCAL ROLE billetto_admin; SELECT current_user;
COMMIT;`,
    expect: /billetto_visiteur\nbilletto_organisateur\nbilletto_admin/,
  },
  {
    label: 'SET LOCAL ROLE ne survit pas à la transaction',
    sql: `BEGIN; SET LOCAL ROLE billetto_admin; COMMIT;
SELECT current_user;`,
    expect: /^billetto_app$/m,
  },
  {
    label: 'set_config(..., true) : app.user_id ne survit pas à la transaction',
    sql: `BEGIN; SELECT set_config('app.user_id', '42', true); COMMIT;
SELECT 'apres=' || coalesce(current_setting('app.user_id', true), '');`,
    expect: /^apres=$/m,
  },
  {
    label: 'acheter_billet sans contexte utilisateur → BT013',
    sql: `BEGIN; SET LOCAL ROLE billetto_visiteur;
SELECT acheter_billet(2, 1, 1);
ROLLBACK;`,
    expect: /BT013: contexte utilisateur absent/,
  },
  {
    label: 'rembourser_commande sans contexte utilisateur → BT013',
    sql: `BEGIN; SET LOCAL ROLE billetto_visiteur;
CALL rembourser_commande(1);
ROLLBACK;`,
    expect: /BT013: contexte utilisateur absent/,
  },
  {
    label: 'visiteur sans contexte : aucune commande visible',
    sql: `BEGIN; SET LOCAL ROLE billetto_visiteur;
SELECT 'commandes=' || count(*) FROM commandes;
ROLLBACK;`,
    expect: /^commandes=0$/m,
  },
  {
    label: 'rôle visiteur : fonction d’authentification refusée (réservée à billetto_app)',
    sql: `BEGIN; SET LOCAL ROLE billetto_visiteur;
SELECT count(*) FROM authentification_utilisateur('user1@billetto.test');
ROLLBACK;`,
    expect: /42501: permission denied for function authentification_utilisateur/,
  },
];

let failed = 0;
for (const c of checks) {
  const out = asApp(c.sql);
  if (c.expect.test(out)) {
    console.log(`✓ ${c.label}`);
  } else {
    failed++;
    console.error(`✗ ${c.label}\n  attendu : ${c.expect}\n  obtenu  : ${out.trim().split('\n').join('\n            ')}`);
  }
}

if (failed > 0) {
  console.error(`${failed} échec(s) de sécurité en connexion réelle`);
  process.exit(1);
}
console.log('✓ connexion réelle billetto_app : tous les contrôles passent');
