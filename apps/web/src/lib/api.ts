// Appels de l'API REST, un par endpoint (voir doc/api.md).
import { http } from "./http";
import type {
  AdminUser,
  DailySales,
  EventDetail,
  EventSales,
  EventStatus,
  EventSummary,
  EventTypeNode,
  ModePaiement,
  MyTicket,
  OrderDetail,
  OrderSummary,
  Page,
  Payment,
  PriceAuditEntry,
  PurchaseResult,
  RecentOrder,
  Reservation,
  Role,
  SalesSummary,
  Scope,
  TicketPrice,
  User,
  Venue,
} from "./types";

export type EventSort = "date" | "-date" | "prix" | "nom";

export interface EventFilters {
  q?: string;
  ville?: string;
  typeId?: number;
  from?: string;
  to?: string;
  prixMax?: number;
  statut?: EventStatus;
  sort?: EventSort;
  page?: number;
  pageSize?: number;
  scope?: Scope;
}

export interface EventInput {
  nom: string;
  slug: string;
  description: string;
  debut: string;
  fin: string;
  lieuId: number;
  typeEvenementId: number;
  statut?: "draft" | "published";
}

export interface PriceInput {
  nom: string;
  prix: number;
  quota: number;
  dateDebutVente: string;
  dateFinVente: string;
  actif?: boolean;
}

export const api = {
  // Authentification
  me: () => http<{ user: User }>("GET", "/auth/me").then((r) => r.user),
  login: (email: string, password: string) =>
    http<{ user: User }>("POST", "/auth/login", { body: { email, password } }).then((r) => r.user),
  register: (body: { email: string; password: string; prenom: string; nom: string }) =>
    http<{ user: User }>("POST", "/auth/register", { body }).then((r) => r.user),
  logout: () => http<void>("POST", "/auth/logout"),

  // Catalogue
  events: (filters: EventFilters = {}) => http<Page<EventSummary>>("GET", "/events", { query: { ...filters } }),
  event: (ref: string | number, scope: Scope = "public") =>
    http<EventDetail>("GET", `/events/${encodeURIComponent(String(ref))}`, { query: { scope } }),
  eventTypes: () => http<EventTypeNode[]>("GET", "/event-types/tree"),
  cities: () => http<string[]>("GET", "/venues/cities"),
  venues: (ville?: string) => http<Page<Venue>>("GET", "/venues", { query: { ville, pageSize: 100 } }),

  // Gestion des événements (organisateur / admin)
  createEvent: (body: EventInput) => http<EventDetail>("POST", "/events", { body }),
  updateEvent: (id: number, body: Partial<EventInput> & { statut?: EventStatus }) =>
    http<EventDetail>("PATCH", `/events/${id}`, { body }),
  deleteEvent: (id: number) => http<void>("DELETE", `/events/${id}`),
  replaceAttributes: (id: number, attributs: { cle: string; valeur: string }[]) =>
    http<EventDetail>("PUT", `/events/${id}/attributes`, { body: attributs }),
  createPrice: (eventId: number, body: PriceInput) => http<TicketPrice>("POST", `/events/${eventId}/prices`, { body }),

  // Achat et commandes
  purchase: (tarifId: number, quantite: number) =>
    http<PurchaseResult>("POST", "/tickets/purchase", { body: { tarifId, quantite } }),
  // Réservation temporaire (hold) : bloque le quota, à confirmer avant expiration.
  hold: (tarifId: number, quantite: number, modePaiement: ModePaiement) =>
    http<Reservation>("POST", "/orders/hold", { body: { tarifId, quantite, modePaiement } }),
  confirmHold: (reservationId: number) => http<PurchaseResult>("POST", `/orders/${reservationId}/confirm`),
  myTickets: (page = 1, pageSize = 100) => http<Page<MyTicket>>("GET", "/tickets/me", { query: { page, pageSize } }),
  myOrders: (page = 1, pageSize = 20) => http<Page<OrderSummary>>("GET", "/orders/me", { query: { page, pageSize } }),
  order: (id: number) => http<OrderDetail>("GET", `/orders/${id}`),
  orderPayments: (id: number) => http<Payment[]>("GET", `/orders/${id}/payments`),
  refund: (id: number) => http<OrderDetail>("POST", `/orders/${id}/refund`),

  // Statistiques
  summary: () => http<SalesSummary>("GET", "/analytics/summary"),
  eventSales: (sort: "ca" | "billets" | "taux" | "date", page = 1, pageSize = 20) =>
    http<Page<EventSales>>("GET", "/analytics/events", { query: { sort, page, pageSize } }),
  dailySales: (from: string, to: string) => http<DailySales[]>("GET", "/analytics/daily-sales", { query: { from, to } }),
  recentOrders: (limit = 10) => http<RecentOrder[]>("GET", "/analytics/recent-orders", { query: { limit } }),
  priceAudit: (limit = 50) => http<PriceAuditEntry[]>("GET", "/analytics/price-audit", { query: { limit } }),

  // Administration
  users: (q?: string, page = 1) => http<Page<AdminUser>>("GET", "/users", { query: { q, page, pageSize: 25 } }),
  changeRole: (id: number, role: Role, organisateurId: number | null) =>
    http<AdminUser>("PATCH", `/users/${id}/role`, { body: { role, organisateurId } }),
};
