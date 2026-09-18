// Formatage d'affichage uniquement (fuseau Europe/Paris, euros).
const TZ = "Europe/Paris";

/** Montant de l'API ("25.00") ou nombre → « 25 € » / « 25,50 € ». */
export function formatEUR(value: string | number | null | undefined): string {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone: TZ });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ });
}

export function formatDateShort(iso: string): { jour: string; mois: string } {
  const d = new Date(iso);
  return {
    jour: d.toLocaleDateString("fr-FR", { day: "2-digit", timeZone: TZ }),
    mois: d.toLocaleDateString("fr-FR", { month: "short", timeZone: TZ }).replace(".", "").toUpperCase(),
  };
}

export function formatNumber(n: number): string {
  return n.toLocaleString("fr-FR");
}

export function formatPercent(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined) return "—";
  return `${Math.round(ratio * 100)} %`;
}

/** Slug compatible avec l'API (a-z, 0-9, tirets ; jamais uniquement numérique). */
export function slugify(text: string, suffix = ""): string {
  const base = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const slug = [base || "evenement", suffix].filter(Boolean).join("-");
  return /^\d+$/.test(slug) ? `evenement-${slug}` : slug;
}
