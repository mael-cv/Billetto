import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../common/config/config';
import { EmailOutboxJob } from './application/email-outbox.job';
import { EMAIL_OUTBOX_REPOSITORY, MAILER } from './domain/email';
import { PrismaEmailOutboxRepository } from './infrastructure/prisma-email-outbox.repository';
import { NodemailerMailer } from './infrastructure/smtp.mailer';

@Module({
  providers: [
    EmailOutboxJob,
    { provide: EMAIL_OUTBOX_REPOSITORY, useClass: PrismaEmailOutboxRepository },
    {
      // Pas de SMTP configuré : pas de transport, le job reste inactif.
      provide: MAILER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.SMTP_URL ? NodemailerMailer.smtp(config.SMTP_URL, config.MAIL_FROM) : undefined,
    },
  ],
})
export class NotificationsModule {}
