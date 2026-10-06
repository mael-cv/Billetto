import nodemailer, { type Transporter } from 'nodemailer';
import type { Mailer, OutgoingMail } from '../domain/email';

/** Envoi via nodemailer : SMTP en dev/prod (Mailpit en local), jsonTransport en test. */
export class NodemailerMailer implements Mailer {
  constructor(
    private readonly transport: Transporter,
    private readonly from: string,
  ) {}

  static smtp(url: string, from: string): NodemailerMailer {
    return new NodemailerMailer(nodemailer.createTransport(url), from);
  }

  async send(mail: OutgoingMail): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      attachments: mail.attachments.map((a) => ({
        cid: a.cid,
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });
  }
}
