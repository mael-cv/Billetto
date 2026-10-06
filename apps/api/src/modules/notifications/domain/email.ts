import type { Tx } from '../../../common/database/db-context.service';

export type EmailType = 'commande_confirmee' | 'offre_liste_attente';

export interface OrderTicketData {
  billetId: number;
  code: string;
  /** Contenu du QR de check-in (BT1.<code>.<signature>). */
  qrPayload: string;
  tarif: string;
  prix: string | number;
  evenement: string;
  debut: string;
  fuseauHoraire: string;
  enLigne: boolean;
  lieu: string;
  ville: string;
}

export interface OrderEmailData {
  commandeId: number;
  montantTotal: string | number;
  billets: OrderTicketData[];
}

export interface WaitlistEmailData {
  listeAttenteId: number;
  quantite: number;
  expireA: string;
  tarif: string;
  evenement: string;
  debut: string;
  fuseauHoraire: string;
  enLigne: boolean;
}

/** Ligne de l'outbox prise par le job (emails_a_envoyer). */
export type PendingEmail = {
  emailId: number;
  destinataire: string;
  prenom: string;
  tentatives: number;
} & ({ type: 'commande_confirmee'; donnees: OrderEmailData } | { type: 'offre_liste_attente'; donnees: WaitlistEmailData });

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
  /** QR à joindre (PNG), référencés dans le HTML par cid. */
  qrAttachments: { cid: string; filename: string; payload: string }[];
}

export interface EmailOutboxRepository {
  /** Réserve (bail 5 min, SKIP LOCKED) jusqu'à `limit` e-mails. Rôle admin attendu. */
  claim(tx: Tx, limit: number): Promise<PendingEmail[]>;
  mark(tx: Tx, emailId: number, ok: boolean, error?: string): Promise<void>;
}

export const EMAIL_OUTBOX_REPOSITORY = Symbol('EMAIL_OUTBOX_REPOSITORY');

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments: { cid: string; filename: string; content: Buffer; contentType: string }[];
}

/** Transport d'envoi (SMTP en production, jsonTransport en test). */
export interface Mailer {
  send(mail: OutgoingMail): Promise<void>;
}

export const MAILER = Symbol('MAILER');
