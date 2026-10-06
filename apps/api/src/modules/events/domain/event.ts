export type EventStatus = 'draft' | 'published' | 'cancelled' | 'finished';

export interface EventSummary {
  id: number;
  slug: string;
  nom: string;
  statut: EventStatus;
  debut: Date;
  fin: Date;
  lieu: { id: number; nom: string; ville: string };
  type: { id: number; nom: string };
  organisateur: string;
  prixMin: string | null;
  /** Événement en ligne : le front montre aussi l'heure locale du visiteur. */
  enLigne: boolean;
  /** Fuseau IANA d'affichage ; les instants restent en UTC (timestamptz). */
  fuseauHoraire: string;
}

export interface TicketPrice {
  id: number;
  nom: string;
  prix: string;
  quota: number;
  restantes: number;
  dateDebutVente: Date;
  dateFinVente: Date;
  actif: boolean;
}

export interface EventDetail extends Omit<EventSummary, 'lieu' | 'prixMin'> {
  description: string;
  organisateurId: number;
  lieu: { id: number; nom: string; adresse: string; ville: string; codePostal: string; capacite: number };
  attributs: { cle: string; valeur: string }[];
  tarifs: TicketPrice[];
  /** Annulation self-service possible jusqu'à debut - delaiAnnulationHeures. */
  delaiAnnulationHeures: number;
}

/** Une ligne de l'export participants (un billet). */
export interface Participant {
  billetId: number;
  code: string;
  tarif: string;
  prixPaye: string;
  prenom: string;
  nom: string;
  commandeId: number;
  statutCommande: string;
  acheteLe: Date;
  scanne: boolean;
  scanneLe: Date | null;
}

export interface EventFilters {
  q?: string;
  ville?: string;
  typeId?: number;
  from?: Date;
  to?: Date;
  prixMax?: number;
  statut?: EventStatus;
  sort: EventSort;
}

export const EVENT_SORTS = ['date', '-date', 'prix', 'nom'] as const;
export type EventSort = (typeof EVENT_SORTS)[number];

export interface EventInput {
  nom: string;
  slug: string;
  description: string;
  debut: Date;
  fin: Date;
  lieuId: number;
  typeEvenementId: number;
  statut: EventStatus;
  enLigne?: boolean;
  fuseauHoraire?: string;
  delaiAnnulationHeures?: number;
}
