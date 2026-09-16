// Mock content for the Billetto front-end. Pure presentation data — no business
// rules, inventory logic, or pricing rules live here. The real source of truth is
// the backend/PostgreSQL layer; this file only feeds the UI while wiring is stubbed.

export type EventStatus = "draft" | "published" | "cancelled" | "finished";

export interface TicketTier {
  id: string;
  nom: string;
  prix: number; // display price in EUR, provided by API
  description: string;
  disponible: boolean; // availability flag as reported by API — UI only renders it
  restants?: number; // informational count from API
}

export interface EventAttribute {
  cle: string;
  valeur: string;
}

export interface Organizer {
  id: string;
  nom: string;
  verifie: boolean;
  evenements: number;
}

export interface Venue {
  nom: string;
  ville: string;
  adresse: string;
  capacite: number;
}

export interface BilettoEvent {
  id: string;
  slug: string;
  nom: string;
  categorie: string;
  type: string;
  date: string; // ISO date
  heure: string;
  lieu: Venue;
  organisateur: Organizer;
  image: string;
  description: string;
  attributs: EventAttribute[];
  tarifs: TicketTier[];
  aPartirDe: number;
  statut: EventStatus;
  tendance?: boolean;
  featured?: boolean;
}

const img = (id: string, w = 1200, h = 800) =>
  `https://images.unsplash.com/photo-${id}?w=${w}&h=${h}&fit=crop&auto=format`;

export const categories = [
  "Tout",
  "Concerts",
  "Clubbing",
  "Festivals",
  "Sport",
  "Arts",
  "Conférences",
];

export const cities = ["Toutes les villes", "Paris", "Lyon", "Marseille", "Bordeaux", "Lille", "Nantes"];

const orgs: Organizer[] = [
  { id: "o1", nom: "Nuits Sonores", verifie: true, evenements: 42 },
  { id: "o2", nom: "Collectif Halo", verifie: true, evenements: 18 },
  { id: "o3", nom: "La Machine", verifie: true, evenements: 91 },
  { id: "o4", nom: "Studio Est", verifie: false, evenements: 6 },
];

export const events: BilettoEvent[] = [
  {
    id: "e1",
    slug: "resident-warehouse-paris",
    nom: "RESIDENT — Warehouse Session 07",
    categorie: "Clubbing",
    type: "Electro",
    date: "2026-10-03",
    heure: "23:00",
    lieu: { nom: "Dock B", ville: "Paris", adresse: "12 Quai de la Marne, 75019", capacite: 1800 },
    organisateur: orgs[2],
    image: img("1516450360452-9312f5e86fc7"),
    description:
      "Une nuit continue dédiée à la techno hypnotique. Trois espaces, un line-up international et un système son calibré sur mesure. Portes à 23h, dernière entrée à 3h.",
    attributs: [
      { cle: "Âge minimum", valeur: "18 ans" },
      { cle: "Dress code", valeur: "Libre" },
      { cle: "Vestiaire", valeur: "Oui" },
      { cle: "Fin", valeur: "07:00" },
    ],
    tarifs: [
      { id: "t1", nom: "Early Bird", prix: 19, description: "Quantité limitée", disponible: false, restants: 0 },
      { id: "t2", nom: "Standard", prix: 28, description: "Accès complet", disponible: true, restants: 240 },
      { id: "t3", nom: "VIP", prix: 49, description: "Espace privatisé + coupe-file", disponible: true, restants: 60 },
    ],
    aPartirDe: 28,
    statut: "published",
    tendance: true,
    featured: true,
  },
  {
    id: "e2",
    slug: "aurora-live-lyon",
    nom: "Aurora — Live Orchestral",
    categorie: "Concerts",
    type: "Live",
    date: "2026-10-11",
    heure: "20:30",
    lieu: { nom: "Auditorium de Lyon", ville: "Lyon", adresse: "149 Rue Garibaldi, 69003", capacite: 2100 },
    organisateur: orgs[0],
    image: img("1470229722913-7c0e2dbbafd3"),
    description:
      "Aurora réinvente son répertoire accompagnée d'un orchestre de 40 musiciens. Une soirée unique entre pop cinématographique et arrangements symphoniques.",
    attributs: [
      { cle: "Placement", valeur: "Assis numéroté" },
      { cle: "Durée", valeur: "1h50" },
      { cle: "Accessibilité", valeur: "PMR" },
    ],
    tarifs: [
      { id: "t4", nom: "Balcon", prix: 39, description: "2e catégorie", disponible: true, restants: 120 },
      { id: "t5", nom: "Orchestre", prix: 65, description: "1re catégorie", disponible: true, restants: 45 },
      { id: "t6", nom: "Carré Or", prix: 95, description: "Premiers rangs", disponible: true, restants: 12 },
    ],
    aPartirDe: 39,
    statut: "published",
    featured: true,
  },
  {
    id: "e3",
    slug: "sunset-festival-marseille",
    nom: "Sunset Festival — Jour 1",
    categorie: "Festivals",
    type: "Festival",
    date: "2026-10-18",
    heure: "16:00",
    lieu: { nom: "Plage du Prado", ville: "Marseille", adresse: "Av. Pierre Mendès France, 13008", capacite: 12000 },
    organisateur: orgs[1],
    image: img("1533174072545-7a4b6ad7a6c3"),
    description:
      "Trois scènes face à la Méditerranée, du coucher de soleil jusqu'au bout de la nuit. Pass jour ou pass 3 jours disponibles.",
    attributs: [
      { cle: "Âge minimum", valeur: "16 ans" },
      { cle: "Parking", valeur: "Oui" },
      { cle: "Cashless", valeur: "Oui" },
    ],
    tarifs: [
      { id: "t7", nom: "Pass Jour", prix: 45, description: "Accès samedi", disponible: true, restants: 900 },
      { id: "t8", nom: "Pass 3 Jours", prix: 110, description: "Accès complet", disponible: true, restants: 300 },
      { id: "t9", nom: "Golden Pass", prix: 220, description: "Zone premium + backstage", disponible: true, restants: 40 },
    ],
    aPartirDe: 45,
    statut: "published",
    tendance: true,
  },
  {
    id: "e4",
    slug: "jazz-cave-bordeaux",
    nom: "Blue Note Sessions",
    categorie: "Concerts",
    type: "Jazz",
    date: "2026-09-27",
    heure: "21:00",
    lieu: { nom: "La Cave", ville: "Bordeaux", adresse: "8 Rue du Loup, 33000", capacite: 220 },
    organisateur: orgs[3],
    image: img("1511192336575-5a79af67a629"),
    description:
      "Une soirée intimiste au cœur du vieux Bordeaux. Quartet acoustique, bar à cocktails et ambiance feutrée.",
    attributs: [
      { cle: "Placement", valeur: "Libre" },
      { cle: "Consommation", valeur: "1 boisson incluse" },
    ],
    tarifs: [
      { id: "t10", nom: "Standard", prix: 24, description: "Entrée + boisson", disponible: true, restants: 80 },
      { id: "t11", nom: "Carré Scène", prix: 38, description: "Tables premières loges", disponible: true, restants: 8 },
    ],
    aPartirDe: 24,
    statut: "published",
    tendance: true,
  },
  {
    id: "e5",
    slug: "derby-nord-lille",
    nom: "Derby du Nord — LOSC vs RC Lens",
    categorie: "Sport",
    type: "Football",
    date: "2026-11-02",
    heure: "17:00",
    lieu: { nom: "Stade Pierre-Mauroy", ville: "Lille", adresse: "261 Bd de Tournai, 59650", capacite: 50000 },
    organisateur: orgs[2],
    image: img("1522778119026-d647f0596c20"),
    description:
      "Le choc de la région dans une ambiance électrique. Toutes les tribunes disponibles selon la catégorie choisie.",
    attributs: [
      { cle: "Placement", valeur: "Par tribune" },
      { cle: "Enfants", valeur: "Tarif -12 ans" },
    ],
    tarifs: [
      { id: "t12", nom: "Virage", prix: 22, description: "Tribune populaire", disponible: true, restants: 1400 },
      { id: "t13", nom: "Latérale", prix: 45, description: "Vue centrale", disponible: true, restants: 600 },
      { id: "t14", nom: "Tribune Présidentielle", prix: 120, description: "Salon + parking", disponible: false, restants: 0 },
    ],
    aPartirDe: 22,
    statut: "published",
  },
  {
    id: "e6",
    slug: "design-summit-nantes",
    nom: "Design Summit 2026",
    categorie: "Conférences",
    type: "Conférence",
    date: "2026-11-14",
    heure: "09:00",
    lieu: { nom: "La Cité", ville: "Nantes", adresse: "5 Rue de Valmy, 44000", capacite: 1200 },
    organisateur: orgs[0],
    image: img("1540575467063-178a50c2df87"),
    description:
      "Une journée de talks et d'ateliers autour du design produit, de la recherche et des systèmes d'interface. Networking et déjeuner inclus.",
    attributs: [
      { cle: "Déjeuner", valeur: "Inclus" },
      { cle: "Replay", valeur: "Oui" },
      { cle: "Langue", valeur: "FR / EN" },
    ],
    tarifs: [
      { id: "t15", nom: "Blind Bird", prix: 89, description: "Épuisé", disponible: false, restants: 0 },
      { id: "t16", nom: "Standard", prix: 149, description: "Accès + replay", disponible: true, restants: 320 },
      { id: "t17", nom: "Pro", prix: 249, description: "Ateliers + lounge", disponible: true, restants: 90 },
    ],
    aPartirDe: 149,
    statut: "published",
    featured: true,
  },
  {
    id: "e7",
    slug: "night-gallery-paris",
    nom: "Night Gallery — Immersive",
    categorie: "Arts",
    type: "Exposition",
    date: "2026-10-25",
    heure: "19:00",
    lieu: { nom: "Atelier des Lumières", ville: "Paris", adresse: "38 Rue Saint-Maur, 75011", capacite: 700 },
    organisateur: orgs[1],
    image: img("1518709268805-4e9042af9f23"),
    description:
      "Une expérience immersive nocturne mêlant projections monumentales et création sonore en direct.",
    attributs: [
      { cle: "Durée", valeur: "1h30" },
      { cle: "Créneaux", valeur: "19h / 21h" },
    ],
    tarifs: [
      { id: "t18", nom: "Standard", prix: 29, description: "Créneau au choix", disponible: true, restants: 200 },
      { id: "t19", nom: "Privilège", prix: 55, description: "Accès prioritaire + catalogue", disponible: true, restants: 30 },
    ],
    aPartirDe: 29,
    statut: "published",
    tendance: true,
  },
  {
    id: "e8",
    slug: "open-air-lyon",
    nom: "Open Air — Closing",
    categorie: "Clubbing",
    type: "House",
    date: "2026-09-20",
    heure: "14:00",
    lieu: { nom: "Le Sucre", ville: "Lyon", adresse: "50 Quai Rambaud, 69002", capacite: 900 },
    organisateur: orgs[3],
    image: img("1493676304819-0d7a8d026dcf"),
    description:
      "La dernière open air de la saison sur les toits de la Confluence. House et disco jusqu'au coucher du soleil.",
    attributs: [
      { cle: "Âge minimum", valeur: "18 ans" },
      { cle: "Terrasse", valeur: "Oui" },
    ],
    tarifs: [
      { id: "t20", nom: "Standard", prix: 18, description: "Accès journée", disponible: true, restants: 150 },
    ],
    aPartirDe: 18,
    statut: "finished",
  },
];

// Purchased tickets shown in "Mes billets" — display data only.
export interface OwnedTicket {
  id: string;
  code: string;
  eventSlug: string;
  eventNom: string;
  tarif: string;
  date: string;
  heure: string;
  lieu: string;
  image: string;
  statut: "valid" | "used" | "refunded";
}

export const ownedTickets: OwnedTicket[] = [
  {
    id: "b1",
    code: "BLT-7F3A-90K2",
    eventSlug: "aurora-live-lyon",
    eventNom: "Aurora — Live Orchestral",
    tarif: "Orchestre",
    date: "2026-10-11",
    heure: "20:30",
    lieu: "Auditorium de Lyon",
    image: img("1470229722913-7c0e2dbbafd3", 400, 300),
    statut: "valid",
  },
  {
    id: "b2",
    code: "BLT-1D8C-44M7",
    eventSlug: "resident-warehouse-paris",
    eventNom: "RESIDENT — Warehouse Session 07",
    tarif: "Standard",
    date: "2026-10-03",
    heure: "23:00",
    lieu: "Dock B, Paris",
    image: img("1516450360452-9312f5e86fc7", 400, 300),
    statut: "valid",
  },
  {
    id: "b3",
    code: "BLT-9A2E-71Q0",
    eventSlug: "open-air-lyon",
    eventNom: "Open Air — Closing",
    tarif: "Standard",
    date: "2026-09-20",
    heure: "14:00",
    lieu: "Le Sucre, Lyon",
    image: img("1493676304819-0d7a8d026dcf", 400, 300),
    statut: "used",
  },
];

// Organizer analytics — figures come from backend views/materialized views.
export const dailySales = [
  { jour: "01/09", billets: 210, ca: 6120 },
  { jour: "02/09", billets: 340, ca: 9870 },
  { jour: "03/09", billets: 290, ca: 8410 },
  { jour: "04/09", billets: 460, ca: 13340 },
  { jour: "05/09", billets: 520, ca: 15080 },
  { jour: "06/09", billets: 610, ca: 17690 },
  { jour: "07/09", billets: 580, ca: 16820 },
  { jour: "08/09", billets: 720, ca: 20880 },
  { jour: "09/09", billets: 690, ca: 20010 },
  { jour: "10/09", billets: 810, ca: 23490 },
  { jour: "11/09", billets: 940, ca: 27260 },
  { jour: "12/09", billets: 880, ca: 25520 },
];

export const topEvents = [
  { nom: "Sunset Festival — Jour 1", billets: 8420, ca: 412300, remplissage: 0.7 },
  { nom: "RESIDENT — Warehouse 07", billets: 1560, ca: 48200, remplissage: 0.87 },
  { nom: "Aurora — Live Orchestral", billets: 1890, ca: 96400, remplissage: 0.9 },
  { nom: "Night Gallery — Immersive", billets: 640, ca: 20100, remplissage: 0.91 },
];

export interface OrderRow {
  id: string;
  client: string;
  event: string;
  montant: number;
  statut: "paid" | "pending" | "refunded" | "cancelled";
  date: string;
}

export const recentOrders: OrderRow[] = [
  { id: "CMD-40921", client: "Camille Roux", event: "Aurora — Live Orchestral", montant: 130, statut: "paid", date: "12/09 14:22" },
  { id: "CMD-40920", client: "Yanis Benali", event: "Sunset Festival", montant: 220, statut: "paid", date: "12/09 13:58" },
  { id: "CMD-40919", client: "Léa Fontaine", event: "RESIDENT — Warehouse 07", montant: 56, statut: "pending", date: "12/09 13:41" },
  { id: "CMD-40918", client: "Marco Silva", event: "Night Gallery", montant: 29, statut: "refunded", date: "12/09 12:30" },
  { id: "CMD-40917", client: "Inès Cohen", event: "Design Summit 2026", montant: 249, statut: "paid", date: "12/09 11:05" },
  { id: "CMD-40916", client: "Tom Girard", event: "Blue Note Sessions", montant: 48, statut: "cancelled", date: "12/09 10:47" },
];

export const adminUsers = [
  { id: "u1", nom: "Camille Roux", email: "camille@mail.com", role: "visitor", commandes: 12, inscrit: "2025-03-11" },
  { id: "u2", nom: "Nuits Sonores", email: "contact@nuitssonores.fr", role: "organizer", commandes: 0, inscrit: "2024-11-02" },
  { id: "u3", nom: "Yanis Benali", email: "yanis@mail.com", role: "visitor", commandes: 4, inscrit: "2025-06-20" },
  { id: "u4", nom: "Admin Billetto", email: "admin@billetto.io", role: "admin", commandes: 0, inscrit: "2024-01-01" },
  { id: "u5", nom: "Collectif Halo", email: "hello@halo.co", role: "organizer", commandes: 0, inscrit: "2025-02-14" },
];

export const eventTypeTree = [
  { nom: "Musique", enfants: ["Concert", "Festival", "Clubbing"] },
  { nom: "Sport", enfants: ["Football", "Basket", "Tennis"] },
  { nom: "Culture", enfants: ["Exposition", "Théâtre", "Conférence"] },
];

export function formatEUR(n: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "long" });
}

export function formatDateShort(iso: string) {
  const d = new Date(iso);
  return {
    jour: d.toLocaleDateString("fr-FR", { day: "2-digit" }),
    mois: d.toLocaleDateString("fr-FR", { month: "short" }).replace(".", "").toUpperCase(),
  };
}
