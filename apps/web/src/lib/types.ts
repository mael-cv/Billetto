// Types des réponses de l'API (voir doc/api.md). Montants : chaînes décimales ; dates : ISO 8601.

export type Role = "visitor" | "organizer" | "admin";
export type EventStatus = "draft" | "published" | "cancelled" | "finished";
export type OrderStatus = "pending" | "en_attente_virement" | "paid" | "cancelled" | "refunded";
export type Scope = "public" | "manage";

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface User {
  id: number;
  email: string;
  prenom: string;
  nom: string;
  role: Role;
  organisateurId: number | null;
}

export interface EventSummary {
  id: number;
  slug: string;
  nom: string;
  statut: EventStatus;
  debut: string;
  fin: string;
  lieu: { id: number; nom: string; ville: string };
  type: { id: number; nom: string };
  organisateur: string;
  prixMin: string | null;
}

export interface TicketPrice {
  id: number;
  nom: string;
  prix: string;
  quota: number;
  restantes: number;
  dateDebutVente: string;
  dateFinVente: string;
  actif: boolean;
}

export interface EventDetail {
  id: number;
  slug: string;
  nom: string;
  description: string;
  statut: EventStatus;
  debut: string;
  fin: string;
  organisateurId: number;
  organisateur: string;
  lieu: { id: number; nom: string; adresse: string; ville: string; codePostal: string; capacite: number };
  type: { id: number; nom: string };
  attributs: { cle: string; valeur: string }[];
  tarifs: TicketPrice[];
}

export interface EventTypeNode {
  id: number;
  parentId: number | null;
  nom: string;
  niveau: number;
  chemin: string;
}

export interface Venue {
  id: number;
  nom: string;
  adresse: string;
  ville: string;
  codePostal: string;
  capacite: number;
}

export interface PurchaseResult {
  commandeId: number;
  paiementId: number;
  billetIds: number[];
  montantTotal: string;
}

export type ModePaiement = "carte" | "virement";
export type ReservationStatus = "active" | "confirmee" | "expiree" | "annulee";

export interface Reservation {
  id: number;
  tarifId: number;
  quantite: number;
  statut: ReservationStatus;
  modePaiement: ModePaiement;
  expireA: string;
  montantTotal: string;
}

export interface OrderTicket {
  id: number;
  code: string;
  evenementId: number;
  evenement: string;
  debut: string;
  lieu: string;
  ville: string;
  tarif: string;
  prixPaye: string;
}

export interface MyTicket extends OrderTicket {
  commandeId: number;
  statutCommande: OrderStatus;
  /** Contenu du QR de check-in (BT1.<code>.<signature>). */
  qrPayload: string;
}

export interface OrderSummary {
  id: number;
  statut: OrderStatus;
  montantTotal: string;
  createdAt: string;
  nbBillets: number;
}

export interface OrderDetail extends OrderSummary {
  utilisateurId: number;
  billets: OrderTicket[];
}

export interface Payment {
  id: number;
  reference: string;
  type: "charge" | "refund";
  montant: string;
  statut: "pending" | "succeeded" | "failed";
  createdAt: string;
}

export interface SalesSummary {
  evenements: number;
  evenementsAVenir: number;
  commandes: number;
  billetsVendus: number;
  chiffreAffaires: string;
  tauxRemplissageMoyen: number | null;
  source: "vues" | "vue_materialisee";
}

export interface EventSales {
  evenementId: number;
  nom: string;
  statut: EventStatus;
  debut: string;
  billetsVendus: number;
  chiffreAffaires: string;
  places: number;
  tauxRemplissage: number | null;
}

export interface DailySales {
  jour: string;
  commandes: number;
  billets: number;
  chiffreAffaires: string;
}

export interface RecentOrder {
  id: number;
  statut: OrderStatus;
  montantTotal: string;
  createdAt: string;
  billets: number;
}

export interface PriceAuditEntry {
  id: number;
  tarifId: number;
  tarif: string | null;
  evenement: string | null;
  action: "UPDATE" | "DELETE";
  ancienPrix: string | null;
  nouveauPrix: string | null;
  ancienQuota: number | null;
  nouveauQuota: number | null;
  auteur: string;
  createdAt: string;
}

export interface AdminUser {
  id: number;
  email: string;
  prenom: string;
  nom: string;
  role: Role;
  organisateurId: number | null;
  createdAt: string;
}

export type WaitlistStatus = "en_attente" | "notifiee" | "confirmee" | "expiree" | "annulee";

/** Vue organisateur d'une file : aucune donnée personnelle de l'inscrit. */
export interface WaitlistQueueItem {
  id: number;
  quantite: number;
  statut: WaitlistStatus;
  /** Rang FIFO (1 = tête) tant que l'inscription est en_attente. */
  position: number | null;
  notifieA: string | null;
  expireA: string | null;
  createdAt: string;
}

export interface WaitlistEntry extends WaitlistQueueItem {
  tarifId: number;
  tarif: string;
  evenementId: number;
  evenement: string;
}

export type ScanResult = "ok" | "doublon" | "invalide" | "annule" | "mauvais_evenement";

export interface ScanOutcome {
  scanId: number;
  clientScanId: string;
  resultat: ScanResult;
  /** Scan déjà reçu par le serveur : réponse d'origine renvoyée. */
  rejeu: boolean;
  billetId: number | null;
  tarif: string | null;
  titulaire: string | null;
  scanneA: string;
  recuA: string;
  premierScan: { scanneA: string; recuA: string; appareil: string | null } | null;
}

export type ScanBatchItem =
  | ({ status: "done" } & ScanOutcome)
  | { status: "error"; clientScanId: string; error: string; message: string };

export interface CheckinManifestEntry {
  billetId: number;
  codeVerification: string;
  tarif: string;
  titulaire: string;
  dejaScanne: boolean;
  scanneA: string | null;
}

/** Dashboard temps réel (GET /analytics/live), filtré par RLS. */
export interface LiveEvent {
  evenementId: number;
  nom: string;
  debut: string;
  places: number;
  vendus: number;
  /** Holds actifs non expirés, offres de liste d'attente comprises. */
  reserves: number;
  /** Places demandées par les inscrits encore en attente. */
  enAttente: number;
  tauxOccupation: number | null;
  chiffreAffaires: string;
}

export interface LiveDashboard {
  generatedAt: string;
  totaux: { places: number; vendus: number; reserves: number; enAttente: number; chiffreAffaires: string };
  evenements: LiveEvent[];
}
