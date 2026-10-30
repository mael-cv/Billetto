import type { ObjectId } from 'mongodb';

// Documents MongoDB (schéma et index : database/nosql/schema.mjs).
// Les identifiants evenementId / utilisateurId / organisateurId sont les clés
// primaires PostgreSQL : PostgreSQL reste la source de vérité.

export interface ProgrammeItem {
  heure: Date;
  scene?: string;
  titre: string;
  artiste?: string;
  dureeMin?: number;
}

export interface MediaItem {
  type: 'image' | 'video' | 'audio';
  url: string;
  legende?: string;
}

/** Page éditoriale d'un événement (modèle embarqué : lue et écrite d'un bloc). */
export interface EventPageDocument {
  _id?: ObjectId;
  evenementId: number;
  organisateurId: number;
  slug: string;
  templateId: string;
  tags: string[];
  programme: ProgrammeItem[];
  medias: MediaItem[];
  sections: { title: string; icon?: string; content: string }[];
  faq: { question: string; answer: string }[];
  updatedAt: Date;
}

/** Avis d'un acheteur ; la réponse de l'organisateur est imbriquée. */
export interface AvisDocument {
  _id?: ObjectId;
  evenementId: number;
  utilisateurId: number;
  utilisateur: { prenom: string };
  note: number;
  titre?: string;
  commentaire: string;
  utile: number;
  reponseOrganisateur?: { texte: string; date: Date };
  createdAt: Date;
  updatedAt?: Date;
}

export const ACTIVITY_TYPES = ['vue_evenement', 'recherche', 'scan_checkin', 'connexion', 'achat'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/** Entrée du journal d'activité (append-only, TTL 90 jours, charge utile libre). */
export interface ActiviteDocument {
  _id?: ObjectId;
  type: ActivityType;
  ts: Date;
  utilisateurId: number | null;
  evenementId: number | null;
  payload: Record<string, unknown>;
}
