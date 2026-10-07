import nodemailer from 'nodemailer';
import type { AppConfig } from '../../common/config/config';
import type { DbContextService, Tx } from '../../common/database/db-context.service';
import { EmailOutboxJob } from './application/email-outbox.job';
import type { EmailOutboxRepository, Mailer, OrderEmailData, OutgoingMail, PendingEmail } from './domain/email';
import { formatInZone, renderOrderConfirmation, renderWaitlistOffer } from './domain/templates';
import { NodemailerMailer } from './infrastructure/smtp.mailer';

const order: OrderEmailData = {
  commandeId: 42,
  montantTotal: '50.00',
  billets: [1, 2].map((billetId) => ({
    billetId,
    code: `0000000${billetId}-0000-4000-8000-000000000000`,
    qrPayload: `BT1.0000000${billetId}-0000-4000-8000-000000000000.AAAAAAAAAAAAAAAAAAAAAA`,
    tarif: 'Standard',
    prix: '25.00',
    evenement: 'Concert <test>',
    debut: '2026-12-31T19:00:00.000Z',
    fuseauHoraire: 'America/New_York',
    enLigne: false,
    lieu: 'Salle',
    ville: 'Bordeaux',
  })),
};

describe('e-mails : contenu', () => {
  it('heure affichée dans le fuseau de l’événement, avec son nom', () => {
    const text = formatInZone('2026-12-31T19:00:00.000Z', 'America/New_York');
    expect(text).toContain('14:00');
    expect(text).toMatch(/New York|Est|heure normale de l’Est/i);
    expect(formatInZone('2026-07-01T18:00:00.000Z', 'Europe/Paris')).toContain('20:00');
  });

  it('confirmation de commande : un QR par billet, HTML échappé, lien vers les billets', () => {
    const mail = renderOrderConfirmation('Alix', order, 'http://localhost:3000');
    expect(mail.subject).toBe('Vos billets — Concert <test>');
    expect(mail.qrAttachments).toEqual([
      { cid: 'qr-1', filename: 'billet-1.png', payload: order.billets[0]?.qrPayload },
      { cid: 'qr-2', filename: 'billet-2.png', payload: order.billets[1]?.qrPayload },
    ]);
    expect(mail.html).toContain('cid:qr-1');
    expect(mail.html).toContain('Concert &lt;test&gt;');
    expect(mail.html).not.toContain('<test>');
    expect(mail.text).toContain('2 billets');
    expect(mail.text).toContain('http://localhost:3000/tickets');
  });

  it('offre de liste d’attente : date limite et lien de confirmation', () => {
    const mail = renderWaitlistOffer(
      'Bao',
      {
        listeAttenteId: 7,
        quantite: 2,
        expireA: '2026-10-06T10:30:00.000Z',
        tarif: 'Fosse',
        evenement: 'Festival',
        debut: '2026-11-01T20:00:00.000Z',
        fuseauHoraire: 'Europe/Paris',
        enLigne: false,
      },
      'http://localhost:3000',
    );
    expect(mail.subject).toBe('Une place vous attend — Festival');
    expect(mail.text).toContain('2 places « Fosse »');
    expect(mail.text).toContain('12:30');
    expect(mail.html).toContain('http://localhost:3000/waitlist');
    expect(mail.qrAttachments).toEqual([]);
  });
});

describe('e-mails : job outbox', () => {
  const pending: PendingEmail = {
    emailId: 5,
    type: 'commande_confirmee',
    destinataire: 'alix@billetto.test',
    prenom: 'Alix',
    tentatives: 1,
    donnees: order,
  };
  const config = { CORS_ORIGIN: 'http://localhost:3000/', EMAIL_OUTBOX_INTERVAL_MS: 0 } as AppConfig;
  // Pas de base : la transaction est simulée, seul l'enchaînement est testé.
  const db = { run: (_actor: unknown, work: (tx: Tx) => Promise<unknown>) => work({} as Tx) } as DbContextService;

  const setup = (mailer: Mailer) => {
    const marks: [number, boolean, string | undefined][] = [];
    const outbox: EmailOutboxRepository = {
      claim: async () => [pending],
      mark: async (_tx, id, ok, error) => {
        marks.push([id, ok, error]);
      },
    };
    return { job: new EmailOutboxJob(db, outbox, config, mailer), marks };
  };

  it('envoie avec les QR en PNG joints puis marque l’e-mail envoyé', async () => {
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const sent: OutgoingMail[] = [];
    const real = new NodemailerMailer(transport, 'Billetto <billets@billetto.local>');
    const { job, marks } = setup({
      send: async (mail) => {
        sent.push(mail);
        await real.send(mail);
      },
    });

    expect(await job.tick()).toBe(1);
    expect(marks).toEqual([[5, true, undefined]]);
    const mail = sent[0];
    expect(mail?.to).toBe('alix@billetto.test');
    expect(mail?.attachments).toHaveLength(2);
    expect(mail?.attachments[0]?.contentType).toBe('image/png');
    // Signature PNG.
    expect(mail?.attachments[0]?.content.subarray(1, 4).toString()).toBe('PNG');
    // Génération PNG + chargement de nodemailer : lent au premier appel sur une machine chargée.
  }, 30_000);

  it('échec SMTP : e-mail marqué en échec (nouvel essai géré par marquer_email)', async () => {
    const { job, marks } = setup({
      send: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    expect(await job.tick()).toBe(0);
    expect(marks).toEqual([[5, false, 'Error: ECONNREFUSED']]);
  // Le job génère les QR avant l'envoi, même si le transport échoue.
  }, 30_000);

  it('sans transport (SMTP_URL absent) : aucun envoi', async () => {
    const outbox: EmailOutboxRepository = { claim: jest.fn(), mark: jest.fn() };
    const job = new EmailOutboxJob(db, outbox, config, undefined);
    expect(await job.tick()).toBe(0);
    expect(outbox.claim).not.toHaveBeenCalled();
  });
});
