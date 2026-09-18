// Aides de présentation. Elles ne décident de rien : l'API reste l'autorité
// (acheter_billet refuse un achat hors période, quota épuisé, etc.).
import type { EventStatus, TicketPrice } from "./types";

// La base ne stocke pas d'image : visuel choisi d'après le type d'événement.
const unsplash = (id: string, w = 1200, h = 800) =>
  `https://images.unsplash.com/photo-${id}?w=${w}&h=${h}&fit=crop&auto=format`;

const IMAGES: Record<string, string[]> = {
  Rock: ["1459749411175-04bf5292ceea", "1501386761578-eac5c94b800a"],
  Jazz: ["1511192336575-5a79af67a629", "1415201364774-f6f0bb35f28f"],
  Electro: ["1516450360452-9312f5e86fc7", "1574391884720-bbc3740c59d1"],
  Festival: ["1470229722913-7c0e2dbbafd3", "1533174072545-7a4b6ad7a6c3"],
  "Ligue 1": ["1489944440615-453fc2b6a9a9", "1522778119026-d647f0596c20"],
  "Ligue 2": ["1522778119026-d647f0596c20", "1489944440615-453fc2b6a9a9"],
  Basketball: ["1546519638-68e109498ffc", "1504450758481-7338eba7524a"],
  Théâtre: ["1503095396549-807759245b35", "1507676184212-d03ab07a01bf"],
  Humour: ["1527224857830-43a7acc85260", "1585699324551-f6c309eedeca"],
  Danse: ["1508700929628-666bc8bd84ea", "1518834107812-67b0b7c58434"],
  Tech: ["1540575467063-178a50c2df87", "1515187029135-18ee286d815b"],
  Business: ["1515187029135-18ee286d815b", "1540575467063-178a50c2df87"],
};
const FALLBACK = ["1492684223066-81342ee5ff30", "1429962714451-bb934ecdc4ec"];

export function eventImage(event: { id: number; type: { nom: string } }, w?: number, h?: number): string {
  const choices = IMAGES[event.type.nom] ?? FALLBACK;
  return unsplash(choices[event.id % choices.length] ?? FALLBACK[0]!, w, h);
}

export type TierAvailability = "disponible" | "epuise" | "bientot" | "terminee" | "inactif";

/** État affiché d'un tarif, à partir des données renvoyées par l'API. */
export function tierAvailability(
  tarif: Pick<TicketPrice, "actif" | "restantes" | "dateDebutVente" | "dateFinVente">,
  event: { debut: string; statut: EventStatus },
  now: Date = new Date(),
): TierAvailability {
  if (!tarif.actif || event.statut !== "published") return "inactif";
  if (now >= new Date(event.debut) || now >= new Date(tarif.dateFinVente)) return "terminee";
  if (now < new Date(tarif.dateDebutVente)) return "bientot";
  if (tarif.restantes <= 0) return "epuise";
  return "disponible";
}

export const AVAILABILITY_LABEL: Record<TierAvailability, string> = {
  disponible: "Disponible",
  epuise: "Épuisé",
  bientot: "Bientôt en vente",
  terminee: "Vente terminée",
  inactif: "Indisponible",
};

export const STATUS_LABEL: Record<EventStatus, string> = {
  published: "Publié",
  draft: "Brouillon",
  cancelled: "Annulé",
  finished: "Terminé",
};

/** Libellés lisibles des clés EAV connues. */
export const ATTRIBUTE_LABEL: Record<string, string> = {
  age_minimum: "Âge minimum",
  dress_code: "Dress code",
  parking: "Parking",
  accessibilite_pmr: "Accessibilité PMR",
};

export function attributeLabel(cle: string): string {
  return ATTRIBUTE_LABEL[cle] ?? cle.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export function attributeValue(cle: string, valeur: string): string {
  if (cle === "age_minimum") return valeur === "0" ? "Tous publics" : `${valeur} ans`;
  if (valeur === "oui") return "Oui";
  if (valeur === "non") return "Non";
  return valeur;
}
