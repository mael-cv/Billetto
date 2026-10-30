import { useQuery } from "@tanstack/react-query";
import { api, type EventFilters } from "./api";
import type { Scope } from "./types";

// Clés de cache centralisées : les mutations invalident par préfixe.
export const keys = {
  events: (filters: EventFilters) => ["events", filters] as const,
  event: (ref: string | number, scope: Scope) => ["event", String(ref), scope] as const,
  eventTypes: ["event-types"] as const,
  cities: ["cities"] as const,
  venues: (ville?: string) => ["venues", ville ?? ""] as const,
  myTickets: ["me", "tickets"] as const,
  myOrders: ["me", "orders"] as const,
  myWaitlist: ["me", "waitlist"] as const,
  tarifWaitlist: (tarifId: number) => ["waitlist", "tarif", tarifId] as const,
  order: (id: number) => ["order", id] as const,
  analytics: (name: string, ...args: unknown[]) => ["analytics", name, ...args] as const,
  users: (q: string, page: number) => ["users", q, page] as const,
  // Base documentaire MongoDB
  eventPage: (ref: string | number, scope: Scope) => ["event-page", String(ref), scope] as const,
  reviews: (ref: string | number, page: number) => ["reviews", String(ref), page] as const,
  organizerReviews: (sansReponse: boolean, page: number) => ["organizer-reviews", sansReponse, page] as const,
  trending: (jours: number) => ["trending", jours] as const,
  eventActivity: (id: number, granularite: string) => ["event-activity", id, granularite] as const,
};

export const useEventTypes = () =>
  useQuery({ queryKey: keys.eventTypes, queryFn: api.eventTypes, staleTime: 60 * 60_000 });

export const useCities = () => useQuery({ queryKey: keys.cities, queryFn: api.cities, staleTime: 60 * 60_000 });

export const useEvents = (filters: EventFilters) =>
  useQuery({ queryKey: keys.events(filters), queryFn: () => api.events(filters), placeholderData: (prev) => prev });

/** Types racines (Musique, Sport…) pour la navigation par catégorie. */
export function useRootTypes() {
  const tree = useEventTypes();
  return { ...tree, data: tree.data?.filter((t) => t.parentId === null) };
}

// Polling : une offre de liste d'attente n'est « notifiée » que par son statut.
export const useMyWaitlist = (enabled: boolean) =>
  useQuery({ queryKey: keys.myWaitlist, queryFn: api.myWaitlist, enabled, refetchInterval: 30_000 });

/** Événements tendance : classement MongoDB croisé avec le catalogue PostgreSQL. */
export const useTrending = (jours = 7, limit = 8) =>
  useQuery({ queryKey: keys.trending(jours), queryFn: () => api.trending(jours, limit), staleTime: 60_000 });

export const useEventPage = (ref: string | number, scope: Scope = "public") =>
  useQuery({ queryKey: keys.eventPage(ref, scope), queryFn: () => api.eventPage(ref, scope) });

export const useReviews = (ref: string | number, page = 1) =>
  useQuery({ queryKey: keys.reviews(ref, page), queryFn: () => api.reviews(ref, page), placeholderData: (prev) => prev });
