// Thin fake API layer. In production these functions call the REST backend
// (GET /api/v1/events, POST /api/v1/tickets/purchase, ...). Here they resolve
// against mock data with a small delay so the UI can render real loading/error
// states. No business rules, pricing, inventory or authorization live here.

import { events, ownedTickets, type BilettoEvent, type OwnedTicket } from "./data";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface EventFilters {
  q?: string;
  ville?: string;
  categorie?: string;
  prixMax?: number;
  tri?: "date" | "prix" | "tendance";
}

export async function fetchEvents(filters: EventFilters = {}): Promise<BilettoEvent[]> {
  await delay(650);
  // Simulate an occasional network error surface for the error-state UI.
  let out = events.filter((e) => e.statut === "published" || e.statut === "finished");

  if (filters.q) {
    const q = filters.q.toLowerCase();
    out = out.filter(
      (e) => e.nom.toLowerCase().includes(q) || e.lieu.ville.toLowerCase().includes(q) || e.type.toLowerCase().includes(q),
    );
  }
  if (filters.ville && filters.ville !== "Toutes les villes") {
    out = out.filter((e) => e.lieu.ville === filters.ville);
  }
  if (filters.categorie && filters.categorie !== "Tout") {
    out = out.filter((e) => e.categorie === filters.categorie);
  }
  if (typeof filters.prixMax === "number") {
    out = out.filter((e) => e.aPartirDe <= filters.prixMax!);
  }
  if (filters.tri === "prix") out = [...out].sort((a, b) => a.aPartirDe - b.aPartirDe);
  else if (filters.tri === "tendance") out = [...out].sort((a, b) => Number(!!b.tendance) - Number(!!a.tendance));
  else out = [...out].sort((a, b) => +new Date(a.date) - +new Date(b.date));

  return out;
}

export async function fetchEvent(slug: string): Promise<BilettoEvent | null> {
  await delay(500);
  return events.find((e) => e.slug === slug) ?? null;
}

export async function fetchMyTickets(): Promise<OwnedTicket[]> {
  await delay(600);
  return ownedTickets;
}

export interface PurchaseRequest {
  eventSlug: string;
  items: { tarifId: string; quantite: number }[];
  buyer: { prenom: string; nom: string; email: string };
}

export interface PurchaseResult {
  orderNumber: string;
  tickets: { code: string; tarif: string }[];
}

// UI-facing call. The backend PostgreSQL function acheter_billet() owns all the
// real logic (availability, atomicity, payment). This stub only echoes a result
// so the success screen can render.
export async function purchaseTickets(req: PurchaseRequest): Promise<PurchaseResult> {
  await delay(1400);
  const ev = events.find((e) => e.slug === req.eventSlug);
  const tickets = req.items.flatMap((it) => {
    const t = ev?.tarifs.find((x) => x.id === it.tarifId);
    return Array.from({ length: it.quantite }, () => ({
      code: "BLT-" + Math.random().toString(36).slice(2, 6).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase(),
      tarif: t?.nom ?? "Billet",
    }));
  });
  return { orderNumber: "CMD-" + Math.floor(40000 + Math.random() * 9999), tickets };
}
