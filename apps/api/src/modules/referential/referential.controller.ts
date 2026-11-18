import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import type { Actor } from '../../auth/domain/actor';
import { Authenticated, CurrentActor } from '../../auth/presentation/auth.decorators';
import { email } from '../../auth/presentation/auth.dto';
import { DbContextService } from '../../common/database/db-context.service';
import { toNumber } from '../../common/serialization';
import { slugSchema, text } from '../../common/validation/schemas';
import { ZodPipe } from '../../common/validation/zod.pipe';

const organizerSchema = z.strictObject({ nom: text(120), email, slug: slugSchema });

const venueSchema = z.strictObject({
  nom: text(120),
  adresse: text(200),
  ville: text(100),
  codePostal: z.string().regex(/^[0-9]{5}$/, 'code postal à 5 chiffres'),
  capacite: z.coerce.number().int().min(1).max(500_000),
});

interface OrganizerRow {
  id: bigint;
  nom: string;
  email: string;
  slug: string;
}

/**
 * Référentiel géré par l'administrateur : collectifs organisateurs et lieux.
 * Indispensable en mode réel, où aucune donnée de démonstration n'existe.
 * PostgreSQL applique les droits (INSERT réservé au rôle admin) et les contraintes.
 */
@Controller()
@Authenticated('admin')
export class ReferentialController {
  constructor(private readonly db: DbContextService) {}

  @Get('organizers')
  async organizers(@CurrentActor() actor: Actor) {
    const rows = await this.db.run({ userId: actor.userId, role: 'admin' }, (tx) =>
      tx.$queryRaw<OrganizerRow[]>`SELECT id, nom, email, slug FROM organisateurs ORDER BY nom, id LIMIT 500`,
    );
    return rows.map((r) => ({ ...r, id: toNumber(r.id) }));
  }

  @Post('organizers')
  @HttpCode(201)
  async createOrganizer(@CurrentActor() actor: Actor, @Body(new ZodPipe(organizerSchema)) body: z.infer<typeof organizerSchema>) {
    const rows = await this.db.run({ userId: actor.userId, role: 'admin' }, (tx) =>
      tx.$queryRaw<OrganizerRow[]>`
        INSERT INTO organisateurs (nom, email, slug)
        VALUES (${body.nom}, ${body.email.trim().toLowerCase()}, ${body.slug})
        RETURNING id, nom, email, slug`,
    );
    const row = rows[0];
    if (!row) throw new Error('insertion organisateur sans résultat');
    return { ...row, id: toNumber(row.id) };
  }

  @Post('venues')
  @HttpCode(201)
  async createVenue(@CurrentActor() actor: Actor, @Body(new ZodPipe(venueSchema)) body: z.infer<typeof venueSchema>) {
    const rows = await this.db.run({ userId: actor.userId, role: 'admin' }, (tx) =>
      tx.$queryRaw<{ id: bigint }[]>`
        INSERT INTO lieux (nom, adresse, ville, code_postal, capacite)
        VALUES (${body.nom}, ${body.adresse}, ${body.ville}, ${body.codePostal}, ${body.capacite})
        RETURNING id`,
    );
    return { id: toNumber(rows[0]?.id), ...body };
  }
}
