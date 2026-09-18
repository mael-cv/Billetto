// Types des réponses de l'API (voir doc/api.md). Montants : chaînes décimales ; dates : ISO 8601.

export type Role = "visitor" | "organizer" | "admin";
export type EventStatus = "draft" | "published" | "cancelled" | "finished";
export type OrderStatus = "pending" | "paid" | "cancelled" | "refunded";
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
