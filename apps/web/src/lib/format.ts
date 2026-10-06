// Formatage d'affichage uniquement (dates, euros).
//
// Les instants arrivent de l'API en UTC (timestamptz). Le fuseau d'affichage
// est explicite :
//   - par défaut, celui du visiteur (navigateur) ;
//   - pour un événement physique, celui du lieu (evenements.fuseau_horaire) :
//     « 20:00 » doit rester l'heure affichée sur le billet, où que l'on soit ;
//   - pour un événement en ligne, l'heure locale du visiteur, accompagnée de
//     celle de l'événement si elle diffère.

/** Fuseau IANA du navigateur (ex. « Europe/Paris »). */
export function visitorTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

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

export function formatDate(iso: string, timeZone = visitorTimeZone()): string {
  return new Date(iso).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone });
}

export function formatTime(iso: string, timeZone = visitorTimeZone()): string {
  return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone });
}

export function formatDateTime(iso: string, timeZone = visitorTimeZone()): string {
  return new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone });
}

export function formatDateShort(iso: string, timeZone = visitorTimeZone()): { jour: string; mois: string } {
  const d = new Date(iso);
  return {
    jour: d.toLocaleDateString("fr-FR", { day: "2-digit", timeZone }),
    mois: d.toLocaleDateString("fr-FR", { month: "short", timeZone }).replace(".", "").toUpperCase(),
  };
}

/** Champs d'un événement utiles à l'affichage des heures. */
export interface EventTimeZoneInfo {
  enLigne?: boolean;
  fuseauHoraire?: string;
}

/** « America/New_York » → « New York ». */
export function zoneLabel(timeZone: string): string {
  return timeZone.split("/").pop()?.replace(/_/g, " ") ?? timeZone;
}

/** Fuseau dans lequel afficher les dates d'un événement (lieu ; visiteur si en ligne). */
export function eventTimeZone(event: EventTimeZoneInfo, visitor = visitorTimeZone()): string {
  if (event.enLigne || !event.fuseauHoraire) return visitor;
  return event.fuseauHoraire;
}

/**
 * Heure d'un événement, avec la précision nécessaire :
 *   - lieu physique : heure du lieu, suivie de « heure de <ville> » si le
 *     visiteur est dans un autre fuseau ;
 *   - en ligne : heure du visiteur (« chez vous »), suivie de l'heure de
 *     l'événement si elle diffère.
 * La comparaison porte sur l'heure affichée à cet instant précis : deux fuseaux
 * qui ne diffèrent qu'en hiver ou qu'en été sont correctement traités.
 */
export function formatEventTime(iso: string, event: EventTimeZoneInfo, visitor = visitorTimeZone()): string {
  const eventZone = event.fuseauHoraire ?? visitor;
  const atEvent = formatTime(iso, eventZone);
  const atVisitor = formatTime(iso, visitor);
  if (atEvent === atVisitor) return atEvent;
  if (event.enLigne) return `${atVisitor} chez vous (${atEvent} heure de ${zoneLabel(eventZone)})`;
  return `${atEvent} heure de ${zoneLabel(eventZone)}`;
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

/** Décalage (ms) entre l'heure murale d'un fuseau et UTC à un instant donné. */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * Heure murale saisie (« 2026-11-01 », « 20:00 ») dans un fuseau donné → instant
 * ISO UTC. Un organisateur saisit l'heure du lieu, pas celle de son navigateur.
 * Deux passes : le décalage dépend de l'instant (changement d'heure).
 */
export function zonedTimeToIso(date: string, time: string, timeZone: string): string {
  const [y = 0, m = 1, d = 1] = date.split("-").map(Number);
  const [h = 0, mi = 0] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, h, mi);
  let instant = wall - zoneOffsetMs(wall, timeZone);
  instant = wall - zoneOffsetMs(instant, timeZone);
  return new Date(instant).toISOString();
}

/** Fuseaux proposés à la création d'un événement (le fuseau du visiteur est ajouté s'il manque). */
export const COMMON_TIME_ZONES = [
  "Europe/Paris",
  "Europe/London",
  "Europe/Brussels",
  "Europe/Zurich",
  "America/Montreal",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Tokyo",
  "Indian/Reunion",
  "America/Martinique",
  "Pacific/Noumea",
  "UTC",
] as const;
