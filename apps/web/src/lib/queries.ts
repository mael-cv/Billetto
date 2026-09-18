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
  order: (id: number) => ["order", id] as const,
  analytics: (name: string, ...args: unknown[]) => ["analytics", name, ...args] as const,
  users: (q: string, page: number) => ["users", q, page] as const,
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
