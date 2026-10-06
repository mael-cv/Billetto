import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit, Optional } from '@nestjs/common';
import QRCode from 'qrcode';
import { APP_CONFIG, type AppConfig } from '../../../common/config/config';
import { DbContextService } from '../../../common/database/db-context.service';
import {
  EMAIL_OUTBOX_REPOSITORY,
  type EmailOutboxRepository,
  MAILER,
  type Mailer,
  type OutgoingMail,
  type PendingEmail,
} from '../domain/email';
import { renderOrderConfirmation, renderWaitlistOffer } from '../domain/templates';

const BATCH = 20;
// Le job n'a pas d'utilisateur : rôle admin, seul autorisé sur emails_a_envoyer / marquer_email.
const JOB_ACTOR = { userId: null, role: 'admin' } as const;

/**
 * Envoie les e-mails de l'outbox (emails_sortants), alimentée par trigger dans
 * la transaction métier : aucun e-mail n'est perdu si l'API redémarre, aucun
 * n'est envoyé pour une transaction annulée.
 *   1. réservation d'un lot (bail de 5 min, SKIP LOCKED : plusieurs instances
 *      ne prennent jamais la même ligne), transaction courte ;
 *   2. envoi SMTP hors transaction ;
 *   3. résultat enregistré (envoye, ou nouvel essai avec backoff, echec après 5).
 * Sans SMTP_URL ou avec EMAIL_OUTBOX_INTERVAL_MS=0, le job est inactif : les
 * e-mails restent en file.
 */
@Injectable()
export class EmailOutboxJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailOutboxJob.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly db: DbContextService,
    @Inject(EMAIL_OUTBOX_REPOSITORY) private readonly outbox: EmailOutboxRepository,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() @Inject(MAILER) private readonly mailer?: Mailer,
  ) {}

  onModuleInit(): void {
    if (!this.mailer || this.config.EMAIL_OUTBOX_INTERVAL_MS <= 0) {
      this.logger.log('envoi des e-mails désactivé (SMTP_URL absent) : les e-mails restent en file');
      return;
    }
    this.timer = setInterval(() => void this.tick(), this.config.EMAIL_OUTBOX_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** Un passage : renvoie le nombre d'e-mails envoyés avec succès. */
  async tick(): Promise<number> {
    if (!this.mailer || this.running) return 0;
    this.running = true;
    let sent = 0;
    try {
      const batch = await this.db.run(JOB_ACTOR, (tx) => this.outbox.claim(tx, BATCH));
      for (const email of batch) {
        try {
          await this.mailer.send(await this.compose(email));
          await this.db.run(JOB_ACTOR, (tx) => this.outbox.mark(tx, email.emailId, true));
          sent += 1;
        } catch (err) {
          this.logger.warn(`e-mail ${email.emailId} non envoyé (tentative ${email.tentatives}) : ${String(err)}`);
          await this.db.run(JOB_ACTOR, (tx) => this.outbox.mark(tx, email.emailId, false, String(err)));
        }
      }
    } catch (err) {
      this.logger.error(`file d'e-mails inaccessible : ${String(err)}`);
    } finally {
      this.running = false;
    }
    return sent;
  }

  async compose(email: PendingEmail): Promise<OutgoingMail> {
    const webUrl = this.config.CORS_ORIGIN.replace(/\/$/, '');
    const rendered =
      email.type === 'commande_confirmee'
        ? renderOrderConfirmation(email.prenom, email.donnees, webUrl)
        : renderWaitlistOffer(email.prenom, email.donnees, webUrl);
    const attachments = await Promise.all(
      rendered.qrAttachments.map(async (qr) => ({
        cid: qr.cid,
        filename: qr.filename,
        content: await QRCode.toBuffer(qr.payload, { errorCorrectionLevel: 'M', margin: 1, width: 360 }),
        contentType: 'image/png',
      })),
    );
    return { to: email.destinataire, subject: rendered.subject, text: rendered.text, html: rendered.html, attachments };
  }
}
