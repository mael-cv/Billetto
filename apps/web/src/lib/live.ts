import type { LiveEvent } from "./types";

export const LIVE_REFRESH_MS = 5_000;

/**
 * Répartition d'une jauge en pourcentages (vendu, réservé, libre), bornée à
 * 100 % : un quota baissé après coup peut laisser vendus + réservés > places.
 */
export function liveSegments(e: Pick<LiveEvent, "places" | "vendus" | "reserves">): {
  vendu: number;
  reserve: number;
  libre: number;
} {
  if (e.places <= 0) return { vendu: 0, reserve: 0, libre: 0 };
  const pct = (n: number) => (Math.max(0, n) / e.places) * 100;
  const vendu = Math.min(100, pct(e.vendus));
  const reserve = Math.min(100 - vendu, pct(e.reserves));
  return { vendu, reserve, libre: 100 - vendu - reserve };
}

/** « à l'instant », « il y a 7 s », « il y a 3 min ». */
export function freshness(updatedAt: number, now: number): string {
  const s = Math.max(0, Math.round((now - updatedAt) / 1000));
  if (s < 2) return "à l'instant";
  if (s < 60) return `il y a ${s} s`;
  return `il y a ${Math.floor(s / 60)} min`;
}
