// Comptes de démonstration avec de vrais hash Argon2id.
//   visiteur      demo-visiteur@billetto.test
//   organisateur  demo-organisateur@billetto.test   (organisateur n° 1)
//   admin         demo-admin@billetto.test
// Mot de passe : DEMO_PASSWORD (.env), sinon « Billetto-Demo-2026! » (développement uniquement).
// Idempotent : met à jour le hash si le compte existe.
import { hash } from '@node-rs/argon2';
import { psql } from './psql.mjs';

const password = process.env.DEMO_PASSWORD ?? 'Billetto-Demo-2026!';

// Paramètres OWASP 2024 pour Argon2id : m = 19 MiB, t = 2, p = 1.
const passwordHash = await hash(password, {
  algorithm: 2, // Argon2id
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
});

// Variables psql (:'…') : valeurs échappées par psql, aucune concaténation SQL.
const sql = `
INSERT INTO utilisateurs (email, password_hash, prenom, nom, role_app, organisateur_id)
VALUES
  ('demo-visiteur@billetto.test',     :'hash', 'Camille', 'Visiteur',     'visitor',   NULL),
  ('demo-organisateur@billetto.test', :'hash', 'Hugo',    'Organisateur', 'organizer', (SELECT min(id) FROM organisateurs)),
  ('demo-admin@billetto.test',        :'hash', 'Inès',    'Admin',        'admin',     NULL)
ON CONFLICT ON CONSTRAINT uq_utilisateurs_email
DO UPDATE SET password_hash = EXCLUDED.password_hash,
              role_app = EXCLUDED.role_app,
              organisateur_id = EXCLUDED.organisateur_id;
`;

psql(['-v', `hash=${passwordHash}`], { input: sql, settings: { client_min_messages: 'warning' } });
console.log('✓ comptes de démonstration : demo-visiteur@, demo-organisateur@, demo-admin@billetto.test');
