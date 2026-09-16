1. Architecture cible
                         ┌──────────────────────┐
                         │     Figma Make       │
                         │ React / TypeScript    │
                         │ UI/UX billetterie     │
                         └──────────┬───────────┘
                                    │ HTTPS / REST
                                    ▼
                         ┌──────────────────────┐
                         │     Backend TS       │
                         │ NestJS + Fastify     │
                         │ Clean Architecture   │
                         │ OWASP                 │
                         └──────────┬───────────┘
                                    │
                         ┌──────────▼───────────┐
                         │     Prisma ORM       │
                         │ CRUD / transactions  │
                         └──────────┬───────────┘
                                    │
                       SQL avancé ponctuel
                 vues / fonctions / RLS / EXPLAIN
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │     PostgreSQL       │
                         │                      │
                         │ tables               │
                         │ contraintes          │
                         │ indexes              │
                         │ views               │
                         │ materialized views   │
                         │ functions            │
                         │ procedures           │
                         │ triggers             │
                         │ roles / grants       │
                         │ RLS                  │
                         └──────────────────────┘
                                    │
                 ┌──────────────────┴─────────────────┐
                 ▼                                    ▼
        ┌─────────────────┐                   ┌────────────────┐
        │    pgAdmin      │                   │   PostgreSQL   │
        │    DB viewer    │                   │    volumes     │
        └─────────────────┘                   └────────────────┘
Stack

Front

Figma Make pour la conception/génération initiale.
React + TypeScript.
TanStack Query pour les appels API/cache.
React Hook Form + Zod pour les formulaires.
Tailwind CSS ou système de design issu de Figma Make.

Backend

NestJS.
Fastify.
TypeScript strict.
Prisma ORM.
Zod ou validation DTO NestJS.
JWT ou session sécurisée en cookie HttpOnly.
Argon2id pour les mots de passe.

BDD

PostgreSQL.
Prisma pour les opérations classiques.
SQL natif versionné pour :
views ;
materialized views ;
functions ;
procedures ;
triggers ;
RLS ;
grants ;
rôles ;
EXPLAIN ANALYZE.

C'est important : le cours présente explicitement Prisma comme exemple d'ORM, mais insiste également sur le fait que PostgreSQL doit rester le moteur de calcul, de contrôle et de protection.

2. Principe fondamental : Prisma ne doit pas cacher PostgreSQL

La règle du projet devrait être :

Prisma pour manipuler le modèle applicatif ; SQL PostgreSQL pour démontrer les notions avancées du cours.

Donc :

Prisma
 ├── CRUD courant
 ├── pagination
 ├── relations
 ├── transactions
 └── typage

SQL PostgreSQL
 ├── CREATE VIEW
 ├── CREATE MATERIALIZED VIEW
 ├── CREATE FUNCTION
 ├── CREATE PROCEDURE
 ├── CREATE TRIGGER
 ├── CREATE POLICY
 ├── GRANT / REVOKE
 ├── EXPLAIN ANALYZE
 └── REFRESH MATERIALIZED VIEW

Les vues matérialisées et les vues doivent être de vrais objets PostgreSQL, puisque le TP demande notamment v_ventes_par_evenement, v_remplissage, v_classement_lieux et mv_ventes_quotidiennes.

3. Modèle de données

Le PDF donne explicitement le noyau suivant :

organisateurs
lieux
evenements
evenement_attributs
tarifs
billets
amities
utilisateurs
commandes
paiements

avec les volumes cibles ci-dessus.

Le PDF ne détaille pas toutes les colonnes de chacune de ces tables dans le document visible. Je ne prétendrais donc pas que les colonnes ci-dessous sont celles « exactes du cours ». Je les utiliserais comme conception d’implémentation, en conservant les concepts et exercices du cours.

organisateurs
id
nom
email
created_at
updated_at
lieux
id
nom
adresse
ville
code_postal
capacite
created_at
updated_at
evenements
id
organisateur_id FK
lieu_id FK
type_evenement_id FK
nom
slug UNIQUE
description
debut
fin
statut
created_at
updated_at

Statuts possibles :

draft
published
cancelled
finished
type_evenements

Je l'ajouterais comme extension pédagogique pour disposer d'une vraie hiérarchie permettant un WITH RECURSIVE.

id
parent_id FK -> type_evenements.id
nom

Cela permet par exemple :

Musique
├── Concert
│   ├── Rock
│   ├── Jazz
│   └── Electro
└── Festival

C'est cohérent avec le rappel du cours sur les arbres et WITH RECURSIVE.

evenement_attributs

Cette table doit rester volontairement proche du défaut pédagogique du cours :

id
evenement_id FK
cle
valeur

Exemples :

age_minimum | 18
dress_code  | casual
parking     | oui

Le document identifie explicitement evenement_attributs comme un « clé/valeur fourre-tout » voulu pour les TPs.

Donc :

ne pas supprimer cette table
la conserver pour l'analyse SQL ;
documenter pourquoi elle est moins saine qu'un modèle structuré ;
ajouter éventuellement une validation par trigger pour le bonus du TP.
tarifs
id
evenement_id FK
nom
prix
quota
date_debut_vente
date_fin_vente
actif
created_at
updated_at

Exemples :

Early Bird
Standard
VIP
Backstage
utilisateurs
id
email UNIQUE
password_hash
prenom
nom
role_app
created_at
updated_at

role_app :

visitor
organizer
admin

Mais ne pas utiliser uniquement cette colonne pour la sécurité : le projet doit aussi démontrer les rôles PostgreSQL et la RLS.

amities
id
utilisateur_id FK
ami_id FK
statut
created_at

Contrainte :

utilisateur_id <> ami_id
UNIQUE(utilisateur_id, ami_id)
commandes
id
utilisateur_id FK
statut
montant_total
created_at
updated_at

Statuts :

pending
paid
cancelled
refunded

Le TP définit une vente comme un billet appartenant à une commande payée.

billets
id
tarif_id FK
commande_id FK
utilisateur_id FK
code UNIQUE
prix_paye
created_at

Pour l'exercice pédagogique, cette table est la table lourde :

≈ 1 800 000 lignes
paiements
id
commande_id FK
reference UNIQUE
montant
statut
created_at
journal_tarifs
id
tarif_id FK
ancien_prix
nouveau_prix
ancien_quota
nouveau_quota
action
created_at

Cette table permet le trigger d'audit demandé par le TP 04. Le cours demande précisément un journal des modifications de tarifs et un trigger AFTER UPDATE ... OR DELETE.

4. Normalisation

La conception devra partir de la 3FN :

1FN
→ valeurs atomiques

2FN
→ pas de dépendance partielle

3FN
→ pas de dépendance entre colonnes non-clés

Le cours insiste notamment sur les listes stockées dans une cellule et sur les dépendances transitives.

Donc interdit :

tags = "vip,concert,paris"

ou :

participant_names = "Alice,Bob,Charlie"

On crée des relations.

La seule entorse volontaire est evenement_attributs, justement pour exploiter le défaut pédagogique du sujet.

5. Contraintes BDD

Tout ce qui peut être garanti par PostgreSQL doit l'être par PostgreSQL.

Exemple :

NOT NULL
UNIQUE
PRIMARY KEY
FOREIGN KEY
CHECK
DEFAULT

Exemples :

CHECK (prix >= 0)

CHECK (quota > 0)

CHECK (fin > debut)

CHECK (montant >= 0)

UNIQUE (evenement_id, nom)

Le cours recommande explicitement les contraintes déclaratives avant les triggers : NOT NULL, CHECK, FK, UNIQUE, GENERATED.

6. Requêtes complexes obligatoires

Le backend doit exposer quelques endpoints reposant directement sur ces objets SQL plutôt que de reconstruire toutes les agrégations dans TypeScript.

Q1 — ventes par événement

CTE + LEFT JOIN.

Objectif :

événement
→ nombre de billets vendus
→ CA

Le TP demande explicitement cette requête avec un CTE et un LEFT JOIN depuis evenements.

Q2 — événements sans aucune vente

Utiliser :

NOT EXISTS

et non :

NOT IN

Le cours insiste sur ce piège à cause des NULL.

Q3 — taux de remplissage

CTE :

places = SUM(quota)
vendus = COUNT(billets)

puis :

vendus / places
Q4 — CA par lieu

LEFT JOIN afin de conserver les lieux sans vente.

Q5 — ventes quotidiennes
date
nombre billets
CA
Q6 — utilisateurs n'ayant jamais commandé

Comparer :

COUNT(*) = 0

avec :

NOT EXISTS
Q7 — CA par ville et type d'événement

Utiliser :

FILTER (WHERE ...)

comme le cours le demande dans son exercice bonus.

7. WITH RECURSIVE

Le projet doit avoir au minimum une vraie requête récursive.

Je recommande :

GET /event-types/tree

avec :

WITH RECURSIVE arbre AS (...)
SELECT ...

Résultat :

Musique
  Concert
    Rock
    Jazz
  Festival
Sport
  Football
    Ligue 1
    Ligue 2

On démontre ainsi :

ancre ;
UNION ALL ;
récursion ;
niveau ;
chemin ;
condition d'arrêt.

C'est exactement le principe montré dans le cours.

8. Vues

Créer :

v_ventes_par_evenement
v_remplissage
v_classement_lieux

La première doit devenir la source des deux suivantes, afin de démontrer les dépendances entre vues.

Le TP demande explicitement cette chaîne.

Exemple conceptuel :

evenements
   │
   └── v_ventes_par_evenement
             │
             ├── v_remplissage
             └── v_classement_lieux

Il faudra également documenter le piège de :

DROP VIEW ...

lorsqu'une autre vue en dépend.

9. Vue matérialisée

Créer :

mv_ventes_quotidiennes

avec :

jour
commandes
billets
ca

Ajouter un index unique sur jour.

Puis démontrer :

REFRESH MATERIALIZED VIEW

puis :

REFRESH MATERIALIZED VIEW CONCURRENTLY

Le cours précise qu'un REFRESH CONCURRENTLY exige un index unique approprié et permet de ne pas bloquer les lectures.

Ajouter un script :

npm run db:refresh-metrics

et éventuellement un job :

cron
  ↓
refresh materialized view concurrently
10. Index : surtout montrer le AVANT / APRÈS

Ne crée pas tous les index dès la première migration.

Je ferais :

migration 001
→ schéma sans les index pédagogiques

migration 002
→ index optimisés

Cela permet de fournir :

docs/performance/
  01-before.sql
  02-after.sql
  results.md

Le cours demande précisément de comparer le plan avant/après et d'utiliser EXPLAIN ANALYZE.

Tests à faire
EXPLAIN ANALYZE
SELECT ...

puis :

EXPLAIN (ANALYZE, BUFFERS)
SELECT ...

Documenter :

Seq Scan
Index Scan
Bitmap Heap Scan
Bitmap Index Scan
Nested Loop
Hash Join
Merge Join
estimated rows ;
actual rows ;
execution time ;
rows removed by filter.

Ces nœuds et leur interprétation sont explicitement traités dans le cours.

Index attendus

Minimum :

billets(tarif_id)
billets(commande_id)
commandes(utilisateur_id)
paiements(commande_id)
evenements(debut)

Puis compléter selon les requêtes réellement observées.

Le sujet demande cinq index dans le TP 03, sur les billets, commandes, paiements et evenements.debut.

Important : chaque FK n'est pas automatiquement indexée en PostgreSQL ; le cours insiste sur ce point.

11. Fonctions PostgreSQL

Créer au minimum :

ca_evenement(event_id)
billets_utilisateur(user_id)

Le TP demande ces deux fonctions.

Exemple :

SELECT ca_evenement(42);

Le backend peut ensuite faire :

await prisma.$queryRaw`
  SELECT ca_evenement(${eventId})
`;
12. Fonction/procédure d'achat

C'est l'une des pièces centrales du projet.

Créer :

acheter_billet(...)

dans PostgreSQL.

Responsabilités :

1. vérifier le tarif
2. vérifier l'événement
3. vérifier la disponibilité
4. vérifier la date
5. créer la commande
6. créer le paiement
7. créer le ou les billets
8. garantir l'atomicité
9. renvoyer les identifiants

Le cours donne explicitement acheter_billet() comme fonction métier étudiée dans le TP.

Le backend ne doit donc pas faire :

SELECT quota
INSERT commande
INSERT billet
UPDATE quota

comme quatre opérations indépendantes.

Il doit appeler le mécanisme transactionnel de la base.

13. Procédure de remboursement

Créer :

rembourser_commande(command_id)

avec :

contrôle du statut
création du paiement négatif / remboursement
changement de statut

Cela correspond directement au TP 04.

14. Triggers
Trigger BEFORE INSERT sur billets

Refuser :

achat d'un billet

pour un événement déjà commencé.

C'est exactement l'un des triggers demandés dans le TP.

Trigger audit tarifs
UPDATE prix
UPDATE quota
DELETE tarif

→ journal_tarifs.

Trigger updated_at

Possible pour :

utilisateurs
evenements
tarifs
commandes

Mais ne pas mettre des triggers partout inutilement.

Le cours rappelle qu'un trigger ROW sur une table très écrite peut coûter cher.

15. Sécurité PostgreSQL

Il faut absolument aller au-delà de « role dans le JWT ».

Le cours traite trois rôles :

billetto_visiteur
billetto_organisateur
billetto_admin

avec des droits différents.

Rôles

Je créerais :

billetto_app
billetto_readonly
billetto_visiteur
billetto_organisateur
billetto_admin

billetto_app est le compte technique utilisé par l'API.

Les rôles métier servent à démontrer les privilèges et les tests.

16. GRANT / REVOKE

Exemple conceptuel :

GRANT USAGE ON SCHEMA public
TO billetto_app;

Puis seulement les permissions nécessaires.

Pour certaines données publiques :

GRANT SELECT (...)

et non :

GRANT SELECT ON TABLE utilisateurs

Le cours montre explicitement qu'on peut descendre jusqu'au niveau colonne et retirer l'accès à l'e-mail.

17. SECURITY DEFINER

acheter_billet() doit être le meilleur exemple.

L'utilisateur applicatif :

n'a PAS

les droits directs d'écriture sur :

commandes
billets
paiements

Il possède :

EXECUTE

sur :

acheter_billet()

Le cours explique exactement cette architecture : fonction SECURITY DEFINER, EXECUTE, absence de droits directs et search_path explicite.

Très important

Dans une fonction SECURITY DEFINER :

SET search_path = public, pg_temp;

et les objets importants doivent être correctement qualifiés.

Le cours insiste explicitement sur ce point pour éviter le piège pg_temp.

18. RLS

La RLS doit être réellement utilisée pour evenements.

Principe :

visitor
→ peut voir les événements publiés

organizer
→ ne voit que les événements dont il est propriétaire

admin
→ voit tout

Le cours propose précisément cette démonstration.

Pour transmettre l'utilisateur courant depuis l'application :

BEGIN;

SELECT set_config(
  'app.user_id',
  '42',
  true
);

SELECT ...

Puis la policy utilise :

current_setting('app.user_id', true)

Le cours recommande exactement ce mécanisme lorsqu'une application se connecte avec un rôle technique unique.

19. Attention aux vues + RLS

Il faut obligatoirement avoir un test de sécurité montrant ce problème :

RLS sur table
        ↓
vue
        ↓
fuite potentielle

Puis corriger la vue avec :

security_invoker = true

Le cours traite explicitement ce piège et la propriété security_invoker.

20. Structure du repository

Je recommande :

billetto/
│
├── apps/
│   ├── web/
│   │   ├── src/
│   │   ├── public/
│   │   ├── tests/
│   │   └── ...
│   │
│   └── api/
│       ├── src/
│       │   ├── modules/
│       │   ├── common/
│       │   ├── auth/
│       │   ├── database/
│       │   └── main.ts
│       ├── test/
│       └── ...
│
├── database/
│   ├── migrations/
│   ├── functions/
│   ├── procedures/
│   ├── triggers/
│   ├── views/
│   ├── materialized-views/
│   ├── roles/
│   ├── policies/
│   ├── seed/
│   ├── benchmarks/
│   └── tests/
│
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
│
├── docs/
│   ├── architecture.md
│   ├── database.md
│   ├── security.md
│   ├── performance.md
│   ├── api.md
│   └── decisions.md
│
├── infra/
│   ├── postgres/
│   └── pgadmin/
│
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── .gitignore
├── README.md
└── package.json
21. Docker Compose

Au minimum :

postgres
pgadmin
api
web

Le PDF utilise déjà PostgreSQL + pgAdmin dans Docker Compose et recommande docker compose up -d --wait.

Services :

services:
  postgres:
  pgadmin:
  api:
  web:

Avec :

healthcheck PostgreSQL
depends_on condition: service_healthy
volume PostgreSQL
volume pgAdmin

Ports locaux :

3000 → web
3001 → api
5432 → PostgreSQL
8080 → pgAdmin
22. Seeder

C'est un point très important.

Ne pas écrire :

for (let i = 0; i < 1_800_000; i++) {
  await prisma.billet.create(...)
}

Ce serait mauvais pédagogiquement et très lent.

Faire deux modes :

SEED_MODE=small
SEED_MODE=full
Small
100 événements
300 tarifs
1 000 utilisateurs
10 000 billets

Pour le développement quotidien.

Full

Objectif proche du sujet :

5 001 événements
15 001 tarifs
100 000 utilisateurs
1 800 000 billets

Pour les benchmarks. Le volume est explicitement celui présenté par le TP Billetto.

Pour les gros volumes :

generate_series(...)
INSERT INTO ...
SELECT ...

directement dans PostgreSQL.

Les données doivent être déterministes, par exemple :

SEED=20260916

afin qu'un benchmark puisse être reproduit.

23. BDD viewer

Je prendrais :

pgAdmin

et pas un outil purement ORM.

Il permet de montrer :

tables
constraints
indexes
views
functions
roles
policies
queries

Le cours utilise déjà pgAdmin comme outil officiel du kit Docker.

24. Règles de nommage
Base PostgreSQL

Tout en snake_case.

evenements
tarifs
utilisateur_id
created_at
updated_at

Jamais :

CamelCase
PascalCase
eventId
PK
id
FK
<entite>_id

Exemple :

organisateur_id
evenement_id
tarif_id
commande_id
Index
idx_<table>_<colonnes>

Exemples :

idx_billets_tarif_id
idx_billets_commande_id
idx_evenements_debut
Contraintes
pk_<table>
fk_<table>_<reference>
uq_<table>_<colonnes>
ck_<table>_<regle>

Exemples :

uq_utilisateurs_email
fk_evenements_organisateur_id
ck_tarifs_prix_positive
Views
v_<nom>
Materialized Views
mv_<nom>
Functions
snake_case

Exemple :

ca_evenement
billets_utilisateur
acheter_billet
Triggers
trg_<table>_<action>

Exemples :

trg_tarifs_audit
trg_billets_validate_date
25. Backend TypeScript

Organisation recommandée :

modules/
├── auth/
├── users/
├── events/
├── venues/
├── pricing/
├── orders/
├── tickets/
├── payments/
├── organizers/
└── analytics/

Chaque module :

controller
application
domain
infrastructure
dto

Exemple :

events/
├── domain/
│   ├── event.entity.ts
│   └── event.repository.ts
├── application/
│   ├── create-event.use-case.ts
│   └── list-events.use-case.ts
├── infrastructure/
│   ├── prisma-event.repository.ts
│   └── event.mapper.ts
├── presentation/
│   ├── events.controller.ts
│   └── event.dto.ts
└── events.module.ts
26. API REST

Exemples :

GET    /api/v1/events
GET    /api/v1/events/:id
POST   /api/v1/events
PATCH  /api/v1/events/:id
DELETE /api/v1/events/:id

GET    /api/v1/events/:id/prices

POST   /api/v1/orders
GET    /api/v1/orders/me
GET    /api/v1/orders/:id

POST   /api/v1/orders/:id/refund

POST   /api/v1/tickets/purchase

GET    /api/v1/tickets/me

GET    /api/v1/analytics/events
GET    /api/v1/analytics/venues
GET    /api/v1/analytics/daily-sales

Les endpoints analytics peuvent directement s'appuyer sur :

views
materialized views
functions
CTE
27. Règles OWASP

Le backend doit appliquer au minimum :

Validation de toutes les entrées
Authentification robuste
Authorization par ressource
Rate limiting
HTTP security headers
CORS strict
Cookies HttpOnly
Secure
SameSite
CSRF si authentification cookie
Hash Argon2id
Pas de secrets dans Git
Pas de mot de passe dans les logs
Pas de stacktrace en production
Requêtes paramétrées
ORM
SQL brut uniquement paramétré
Pagination obligatoire
Limites de taille des payloads
Upload contrôlé
Gestion centralisée des erreurs
Audit des opérations sensibles

Et surtout :

ne jamais faire

SELECT ...
WHERE email = '${email}'

même dans un script pédagogique.

28. Front-end : règles
Composants

Pas de composants monolithiques :

EventCard
EventGrid
EventFilters
TicketSelector
CheckoutSummary
QuantitySelector
OrganizerDashboard
SalesChart
Pages
/
 /events
 /events/:slug
 /checkout
 /checkout/success
 /login
 /register
 /tickets
 /account
 /organizer
 /organizer/events
 /organizer/sales
 /admin
Gestion des états

Chaque écran doit prévoir :

loading
empty
error
success
disabled
hover
focus
mobile
29. Prompt Figma Make

Voici le prompt que je donnerais directement à Figma Make.

Create a premium event-ticketing web application called "Billetto".

The product is an event discovery and ticket purchasing platform with an organizer dashboard.

IMPORTANT:
- This is a real production-oriented UI concept, not a marketing landing page.
- Design a coherent multi-page product experience.
- Do not clone any existing website.
- Use the following products only as design references:
  - Shotgun: event discovery, nightlife/event cards, energetic browsing and filtering
  - Weezevent: clear ticket purchasing flows, event management and organizer-oriented UX
  - Apple: typography discipline, spacing, hierarchy, simplicity, premium visual language
- Create an original visual identity.

DESIGN PRINCIPLES

1. Premium and modern
2. Strong editorial event imagery
3. Excellent typography
4. Generous spacing
5. Simple interaction patterns
6. Very clear prices and CTA hierarchy
7. Minimal visual noise
8. Responsive from mobile to desktop
9. Accessible WCAG-oriented contrast and focus states
10. Every interactive element must have visible hover/focus/disabled states

VISUAL SYSTEM

- 8px spacing system
- 12-column desktop grid
- Responsive mobile layout
- Large expressive headings
- Neutral base palette with one distinctive accent color
- Rounded but restrained cards
- Subtle borders and shadows
- Avoid excessive gradients
- Avoid glassmorphism everywhere
- Use cards only when they improve hierarchy
- Buttons must feel tactile but minimal
- Use consistent iconography

TYPOGRAPHY

- Modern sans-serif
- High contrast between display headings and body text
- Very strong hierarchy:
  Display
  H1
  H2
  H3
  Body
  Caption
- Event names must remain readable even on image-based cards

PAGES TO CREATE

1. HOME
- Header
- Search
- Location selector
- Category navigation
- Featured events
- "Near you"
- "This weekend"
- Trending events
- Editorial event section
- Footer

2. EVENT DISCOVERY
- Search field
- Date filters
- City/location filter
- Event type filter
- Price filter
- Sort
- Responsive event grid
- Empty state
- Loading skeleton

3. EVENT DETAIL
- Large hero image
- Event name
- Date and time
- Venue
- Organizer
- Description
- Event attributes
- Ticket pricing cards
- Quantity selector
- Sticky purchase panel on desktop
- Mobile bottom CTA
- Map placeholder
- Related events

4. CHECKOUT
- Selected tickets
- Quantity editing
- Order summary
- Fees
- Total
- Buyer information
- Payment form
- Security reassurance
- Terms checkbox
- Loading state
- Validation errors

5. PURCHASE SUCCESS
- Confirmation
- Order number
- Tickets list
- Download button
- Add to wallet placeholder
- Calendar action
- Navigation to "My tickets"

6. MY TICKETS
- Upcoming tickets
- Past tickets
- Ticket cards
- QR-code placeholder
- Event information
- Ticket status

7. AUTHENTICATION
- Login
- Register
- Forgot password
- Consistent brand experience
- Password visibility toggle
- Validation states

8. ORGANIZER DASHBOARD
- Revenue summary
- Tickets sold
- Fill rate
- Upcoming events
- Daily sales chart
- Top events
- Recent orders

9. ORGANIZER EVENTS
- Events table/grid
- Search
- Status filters
- Create event CTA
- Edit event
- Publish/unpublish
- Ticket inventory

10. CREATE EVENT
- Multi-step form
- General information
- Date/time
- Venue
- Ticket types
- Quotas
- Images
- Attributes
- Publish step
- Validation and error states

11. ADMIN
- Users
- Organizers
- Events
- Orders
- Payments
- Audit information
- Search and filters

COMPONENT SYSTEM

Create reusable components:
- Header
- SearchBar
- EventCard
- EventCardCompact
- EventGrid
- CategoryChip
- FilterBar
- PriceCard
- QuantitySelector
- TicketCard
- OrderSummary
- DataTable
- StatCard
- ChartCard
- Modal
- Drawer
- Toast
- EmptyState
- LoadingSkeleton
- ErrorState
- FormField
- Pagination
- Tabs
- Badge

INTERACTION DETAILS

- Event cards are clickable
- Primary CTA must always be visually obvious
- On mobile, ticket purchase should remain reachable
- Filters should collapse into a drawer on mobile
- Checkout summary becomes sticky on desktop
- Show optimistic UI only when safe
- Show explicit error feedback
- Never hide important validation feedback

ACCESSIBILITY

- Keyboard navigable
- Visible focus rings
- Semantic buttons/links
- Labels on form fields
- Accessible dialogs
- Accessible tables
- Sufficient contrast
- Do not encode meaning by color only

DEVELOPER HANDOFF

Use reusable components and design tokens.
Keep naming consistent.
Use realistic event and ticket content.
Generate states for loading, empty, error, success, hover, focus, disabled.
The resulting design should be suitable for implementation in React + TypeScript.
30. Règles Figma → code

Le front issu de Figma Make ne doit pas contenir :

SQL
Prisma
business rules
payment logic
authorization
ticket inventory logic

Il doit contenir :

UI
interaction
state rendering
API calls
validation UX
routing

Toutes les règles métier sensibles vont dans :

PostgreSQL
+
backend
31. Prompt Claude Code — backend + BDD

Voici le prompt que je recommande de donner à Claude Code après avoir initialisé le repo.

Tu travailles sur un projet de billetterie événementielle appelé Billetto.

OBJECTIF

Construire un backend TypeScript propre, sécurisé et maintenable, connecté à PostgreSQL avec Prisma ORM.

La priorité du projet est la base de données et l'application concrète des notions du cours SQL avancé fourni au projet.

Le backend doit être propre, mais il ne doit jamais contourner les fonctionnalités PostgreSQL demandées par le projet.

STACK IMPOSÉE

- TypeScript strict
- NestJS
- Fastify
- Prisma ORM
- PostgreSQL
- Docker Compose
- pgAdmin
- REST API
- tests automatisés
- ESLint
- Prettier

ARCHITECTURE

Utiliser une architecture modulaire inspirée Clean Architecture :

apps/api/src/
  modules/
  common/
  database/
  auth/

Chaque module doit séparer :
- domain
- application
- infrastructure
- presentation

Ne pas mélanger logique métier, accès DB et contrôleurs HTTP.

DATABASE-FIRST

Le schéma PostgreSQL est une partie centrale du projet.

Prisma doit servir pour :
- CRUD
- relations
- transactions classiques
- typage
- accès applicatifs courants

Utiliser du SQL versionné pour :
- views
- materialized views
- functions
- procedures
- triggers
- roles
- grants
- revoke
- row level security
- policies
- EXPLAIN
- performance scripts

Ne jamais remplacer un concept PostgreSQL du sujet par une logique TypeScript équivalente.

MODELE

Implémenter au minimum :

organisateurs
lieux
evenements
type_evenements
evenement_attributs
tarifs
utilisateurs
amities
commandes
billets
paiements
journal_tarifs

Le document de cours fournit les tables principales :
organisateurs, lieux, evenements, evenement_attributs, tarifs, billets, amities, utilisateurs, commandes, paiements.

Certaines colonnes exactes ne sont pas détaillées dans le document.
Lorsque tu dois compléter le modèle pour permettre à l'application d'exister, documente explicitement ces choix dans docs/decisions.md.

NORMALISATION

Respecter 1FN, 2FN et 3FN.
Les données doivent être atomiques.
Les relations N-N doivent être représentées par des tables.
Les dépendances fonctionnelles doivent respecter la 3FN.

CONTRAINTES

Utiliser autant que possible :
- NOT NULL
- PRIMARY KEY
- FOREIGN KEY
- UNIQUE
- CHECK
- DEFAULT

Ne pas utiliser un trigger lorsqu'une contrainte déclarative suffit.

TABLE EVENEMENT_ATTRIBUTS

Conserver volontairement evenement_attributs comme table EAV pédagogique.
Ne pas la supprimer.

Ajouter sa documentation dans docs/database.md :
- pourquoi le modèle est flexible
- pourquoi il est moins optimal pour certaines requêtes
- comment il est validé
- quelles seraient les alternatives dans un produit réel

VOLUMETRIE

Prévoir deux modes de seed :

SMALL:
- environ 100 events
- environ 300 tarifs
- environ 1 000 utilisateurs
- environ 10 000 billets

FULL:
- 5 001 événements
- 15 001 tarifs
- 100 000 utilisateurs
- environ 1 800 000 billets

Le seed FULL doit être set-based SQL/PostgreSQL.
Ne pas insérer 1,8 million de lignes avec une boucle Prisma ligne par ligne.

Le seed doit être déterministe.
Supporter une variable :
SEED=20260916

QUERIES COMPLEXES

Implémenter des scripts SQL et services correspondant aux exercices du cours :

1. ventes par événement
   - CTE
   - LEFT JOIN
   - CA
   - événements sans vente conservés

2. événements sans vente
   - NOT EXISTS

3. taux de remplissage
   - CTE des quotas
   - CTE des ventes

4. classement des lieux
   - LEFT JOIN
   - CA
   - lieux sans vente conservés

5. ventes quotidiennes

6. utilisateurs n'ayant jamais commandé
   - comparaison count(*) = 0 / NOT EXISTS

7. CA par ville
   - FILTER
   - nombre d'événements vendus

CTE RECURSIVE

Créer type_evenements avec parent_id.
Implémenter :
GET /api/v1/event-types/tree

La requête doit utiliser WITH RECURSIVE et retourner :
- id
- name
- level
- path

VUES

Créer :

v_ventes_par_evenement
v_remplissage
v_classement_lieux

Faire dépendre les vues les unes des autres lorsque cela correspond au modèle du cours.

Documenter la dépendance entre les vues.

Créer des tests montrant qu'un DROP d'une vue parent est bloqué par ses dépendances.

VUE MATERIALISEE

Créer :

mv_ventes_quotidiennes

Créer un index UNIQUE sur jour.

Fournir :
- refresh classique
- refresh concurrent
- script de refresh
- documentation du compromis fraîcheur/performance

INDEX

Créer d'abord une version de base permettant de montrer les requêtes lentes.

Puis une migration ajoutant les index nécessaires.

Créer au minimum les index utiles aux exercices :
- billets/tarifs
- billets/commandes
- commandes/utilisateurs
- paiements/commandes
- événements/date de début

Ajouter d'autres index uniquement après analyse des requêtes.

Ne jamais créer des index "au cas où".

Créer :
database/benchmarks/

avec :
before/
after/
results/

Utiliser :
EXPLAIN ANALYZE
EXPLAIN (ANALYZE, BUFFERS)

Comparer :
- Seq Scan
- Index Scan
- Bitmap Heap Scan
- Bitmap Index Scan
- Nested Loop
- Hash Join
- Merge Join

Documenter les plans et les gains.

FONCTIONS

Créer :

ca_evenement(event_id)
billets_utilisateur(user_id)

PROCEDURES

Créer :

rembourser_commande(command_id)

ACHAT

Créer une fonction PostgreSQL :

acheter_billet(...)

Cette fonction doit être le mécanisme principal de création d'un achat.

Elle doit contrôler :
- existence du tarif
- disponibilité
- événement
- période de vente
- date de l'événement
- commande
- paiement
- génération des billets
- atomicité

Le backend doit appeler cette fonction plutôt que reproduire toute la logique métier en TypeScript.

SECURITY DEFINER

acheter_billet doit être SECURITY DEFINER.

Définir explicitement :

SET search_path = public, pg_temp;

Révoquer l'exécution PUBLIC.

Accorder EXECUTE uniquement au rôle prévu.

Ne jamais laisser l'utilisateur applicatif écrire directement dans les tables sensibles si la logique doit passer par la fonction.

TRIGGERS

Créer :

1. BEFORE INSERT ON billets
   - refuser un billet si l'événement est déjà commencé

2. AFTER UPDATE OF prix, quota ON tarifs
   - journal_tarifs

3. éventuellement DELETE ON tarifs
   - journal_tarifs

4. updated_at uniquement lorsque pertinent

Documenter chaque trigger avec COMMENT ON.

RLS

Créer une véritable RLS sur evenements.

Scénario :

visitor :
  accès aux événements publics

organizer :
  accès uniquement à ses événements

admin :
  accès global

Le backend utilisera une connexion PostgreSQL technique unique et transmettra l'utilisateur courant via une variable de session transactionnelle :

set_config('app.user_id', ...)

La valeur doit être définie à l'intérieur de la transaction.

Créer les policies correspondantes.

VUES + RLS

Tester explicitement le risque de fuite via les vues.

Utiliser security_invoker = true lorsqu'une vue doit respecter la sécurité de l'appelant.

ROLES

Créer des rôles PostgreSQL :

billetto_app
billetto_readonly
billetto_visiteur
billetto_organisateur
billetto_admin

Utiliser NOLOGIN pour les rôles de groupe lorsque pertinent.

Créer les GRANT et REVOKE les plus fins possibles.

Tester que :
- un visiteur ne peut pas modifier un événement
- un visiteur ne peut pas lire les données privées
- un organisateur ne voit pas les événements des autres organisateurs
- l'admin voit tout

SECURITE BACKEND

Appliquer :
- validation de toutes les entrées
- DTO
- validation des paramètres UUID/int/string
- rate limiting
- CORS strict
- headers sécurisés
- authentification
- autorisation
- Argon2id
- cookies HttpOnly si authentification par cookie
- gestion CSRF si nécessaire
- secrets uniquement via variables d'environnement
- aucune information sensible dans les logs
- erreurs HTTP standardisées
- requêtes paramétrées
- aucun SQL construit par concaténation utilisateur
- pagination
- limites de payload
- contrôle des paramètres de tri et filtre

PRISMA

Créer un PrismaService central.

Pour SQL brut :
- privilégier $queryRaw et $executeRaw paramétrés
- éviter $queryRawUnsafe
- n'utiliser du SQL brut que lorsque PostgreSQL apporte une fonctionnalité non couverte directement par l'ORM

TRANSACTIONS

Toutes les opérations nécessitant atomicité doivent utiliser une transaction.

L'achat doit être atomique.

Les opérations sensibles doivent avoir des tests d'intégration.

TESTS

Créer :
- tests unitaires
- tests API
- tests intégration PostgreSQL
- tests SQL
- tests RLS
- tests fonctions
- tests triggers
- tests permissions
- tests de concurrence sur l'achat

Prévoir des cas :
- achat valide
- quota épuisé
- événement commencé
- tarif inexistant
- commande invalide
- remboursement déjà effectué
- utilisateur non autorisé
- organisateur accédant à un mauvais événement

DOCKER

Créer docker-compose.yml avec :
- postgres
- pgadmin
- api
- web si le front existe déjà

PostgreSQL doit avoir :
- healthcheck
- volume persistant
- variables d'environnement
- configuration locale reproductible

PGADMIN

Préconfigurer si possible la connexion via fichier/server config sans mettre de mot de passe réel dans Git.

README

Le README doit permettre à une personne qui clone le repository de faire :

docker compose up -d --wait

puis :

npm install

puis :

npm run db:migrate

puis :

npm run db:seed:small

et éventuellement :

npm run db:seed:full

Puis expliquer :
- URLs
- PostgreSQL
- pgAdmin
- comptes de démonstration
- migrations
- seed
- tests
- benchmarks
- vues
- fonctions
- triggers
- RLS
- rôles PostgreSQL

COMMANDES NPM

Créer notamment :

npm run dev
npm run build
npm run test
npm run lint
npm run format

npm run db:migrate
npm run db:reset
npm run db:seed:small
npm run db:seed:full

npm run db:refresh-mv
npm run db:benchmark

DOCUMENTATION

Créer :

docs/architecture.md
docs/database.md
docs/security.md
docs/performance.md
docs/api.md
docs/decisions.md

docs/performance.md doit contenir les captures/logs :
- avant index
- après index
- EXPLAIN ANALYZE
- execution time
- observations

DO NOT

- ne pas mettre toute la logique dans les controllers
- ne pas faire un énorme service de 1000 lignes
- ne pas utiliser Prisma pour contourner les vues/functions/triggers/RLS
- ne pas faire de SQL concaténé
- ne pas faire de seed ligne par ligne pour 1,8M de billets
- ne pas stocker des listes dans des colonnes texte
- ne pas ajouter des index sans benchmark
- ne pas exposer les mots de passe
- ne pas commit .env
- ne pas désactiver RLS pour simplifier les tests
- ne pas utiliser un compte PostgreSQL superuser dans l'application

DEFINITION OF DONE

Le projet est considéré terminé uniquement lorsque :

1. docker compose démarre toute la stack
2. PostgreSQL démarre avec migrations
3. pgAdmin est accessible
4. le seed SMALL fonctionne
5. le seed FULL fonctionne
6. Prisma fonctionne
7. les vues fonctionnent
8. la vue matérialisée fonctionne
9. les fonctions fonctionnent
10. la procédure de remboursement fonctionne
11. les triggers fonctionnent
12. les rôles fonctionnent
13. RLS fonctionne
14. les tests d'accès passent
15. les benchmarks avant/après sont présents
16. l'API documentée fonctionne
17. le README permet de reproduire le projet depuis zéro
18. aucun secret n'est présent dans Git
19. lint + tests + build passent
20. chaque notion importante du cours a un exemple concret dans le repository

Avant toute modification importante :
- inspecter le repository
- identifier ce qui existe déjà
- ne pas supprimer de code utile
- privilégier les petits changements vérifiables
- lancer les tests après chaque étape
32. Plan d'implémentation dans l'ordre

Je ferais le projet en 10 étapes, et surtout pas front → back → DB.

Étape 1 — Bootstrap

Livrables :

monorepo
Docker Compose
PostgreSQL
pgAdmin
NestJS
Prisma
ESLint
Prettier
README initial
.env.example
Étape 2 — Schéma DB

Créer :

tables
PK
FK
UNIQUE
CHECK
NOT NULL

Puis inspecter dans pgAdmin.

Étape 3 — Seed

Faire fonctionner :

npm run db:seed:small

puis :

npm run db:seed:full
Étape 4 — SQL avancé

Implémenter :

CTE
NOT EXISTS
LEFT JOIN
FILTER
WITH RECURSIVE
GROUP BY
HAVING

Le programme du cours regroupe précisément ces notions dans le module 1.

Étape 5 — Views / MV
v_ventes_par_evenement
v_remplissage
v_classement_lieux
mv_ventes_quotidiennes
Étape 6 — Performance
EXPLAIN ANALYZE
→ index
→ ANALYZE
→ EXPLAIN ANALYZE

C'est exactement la méthode de diagnostic recommandée par le cours.

Étape 7 — Fonctions / triggers
ca_evenement
billets_utilisateur
acheter_billet
rembourser_commande

trigger audit tarif
trigger contrôle événement
Étape 8 — Sécurité DB
roles
grant
revoke
security definer
search_path
RLS
security_invoker
Étape 9 — Backend

Seulement maintenant :

controllers
use cases
repositories
Prisma
auth
permissions
API
Étape 10 — Front Figma Make

Brancher :

catalogue
event detail
checkout
tickets
organizer dashboard
admin

sur l'API réelle.

33. Scripts GitHub attendus

Je mettrais dans le dépôt :

make up
make down
make reset
make seed-small
make seed-full
make test
make benchmark

ou leurs équivalents npm :

npm run infra:up
npm run infra:down

npm run db:migrate
npm run db:reset

npm run db:seed:small
npm run db:seed:full

npm run db:refresh-mv

npm run test
npm run test:e2e

npm run db:benchmark
34. README final

Le README doit commencer par quelque chose comme :

# Billetto

Billetterie événementielle full-stack construite avec :

- React / TypeScript
- NestJS
- Prisma
- PostgreSQL
- Docker
- pgAdmin

Projet réalisé autour d'un cours SQL avancé PostgreSQL.

## Fonctionnalités

- découverte d'événements
- achat de billets
- commandes
- paiements
- espace utilisateur
- espace organisateur
- dashboard analytique
- rôles PostgreSQL
- RLS
- fonctions PL/pgSQL
- triggers
- views
- materialized views
- index et benchmarking

## Démarrage

docker compose up -d --wait

npm install
npm run db:migrate
npm run db:seed:small

## Services

Web:
http://localhost:3000

API:
http://localhost:3001

pgAdmin:
http://localhost:8080

PostgreSQL:
localhost:5432

Puis une section très importante :

## Démonstration SQL avancé

1. CTE
2. NOT EXISTS
3. WITH RECURSIVE
4. Views
5. Materialized View
6. EXPLAIN ANALYZE
7. Index
8. Functions
9. Procedures
10. Triggers
11. GRANT / REVOKE
12. SECURITY DEFINER
13. RLS

Le cours termine d'ailleurs par exactement cette logique : choisir l'outil PostgreSQL approprié selon le problème — LEFT JOIN, NOT EXISTS, WITH, vue, vue matérialisée, EXPLAIN ANALYZE, fonctions/procédures, triggers, rôles/GRANT et RLS.

35. Ce qui fera réellement la différence lors du rendu

Je viserais ces 6 démonstrations pendant la soutenance :

Démo 1 — 1,8 M de billets
SELECT...
EXPLAIN ANALYZE

→ plan lent

Puis :

CREATE INDEX ...
ANALYZE ...

→ plan différent

Le document fournit lui-même un exemple où un index transforme une lecture parallèle avec beaucoup de lignes filtrées en Bitmap Heap Scan bien plus rapide.

Démo 2 — achat simultané

Deux requêtes tentent le même stock.

Le système ne doit jamais permettre :

quota = 10
11 billets vendus
Démo 3 — fonction métier
SELECT acheter_billet(...);

Puis montrer que l'utilisateur n'a pas accès directement à toutes les tables.

Démo 4 — RLS
organisateur A
→ voit A

organisateur B
→ voit B

admin
→ voit tout
Démo 5 — vue matérialisée
achat
↓
view normale → immédiatement modifiée
mv → ancienne valeur
↓
refresh concurrently
↓
nouvelle valeur

Le comportement de fraîcheur différent entre vue et vue matérialisée est explicitement expliqué dans le cours.

Démo 6 — audit

Modifier un tarif :

tarifs.prix

puis afficher automatiquement :

journal_tarifs

grâce au trigger.

36. Le principe architectural à garder jusqu'au bout

La séparation finale doit être :

FRONT
"Que veut faire l'utilisateur ?"

        ↓

API
"L'utilisateur a-t-il le droit ? Quelle opération appeler ?"

        ↓

ORM
"Comment accéder proprement au modèle ?"

        ↓

POSTGRESQL
"Quelles données sont valides ?
Qui a le droit de les voir ?
Quelle règle métier doit être atomique ?
Comment exécuter la requête efficacement ?"

C'est exactement l'esprit du cours : la base n'est pas uniquement un entrepôt, elle calcule, optimise, contrôle et protège.

Et pour ce projet, c'est le bon axe : le front doit être propre, le backend doit être propre, mais la vraie démonstration technique doit se trouver dans PostgreSQL.

Ordre de priorité que je suivrais
1. Modèle PostgreSQL
2. Contraintes / normalisation
3. Seed SMALL
4. Requêtes complexes
5. Seed FULL
6. Index + EXPLAIN
7. Views / MV
8. Functions / procedures
9. Triggers
10. Roles / grants / RLS
11. Tests DB
12. Prisma
13. API
14. Auth / OWASP
15. Front Figma Make
16. Documentation
17. Docker final
18. GitHub / CI

Le dépôt doit ainsi raconter une histoire technique claire : modéliser → contraindre → interroger → optimiser → encapsuler → sécuriser → exposer à l'application. C'est aussi la progression naturelle du document de cours.