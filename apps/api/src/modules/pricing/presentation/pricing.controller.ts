import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import type { Actor } from '../../../auth/domain/actor';
import { Authenticated, CurrentActor } from '../../../auth/presentation/auth.decorators';
import { dateSchema, idSchema, moneySchema, text } from '../../../common/validation/schemas';
import { ZodPipe } from '../../../common/validation/zod.pipe';
import {
  CreatePriceUseCase,
  DeletePriceUseCase,
  ListPricesUseCase,
  UpdatePriceUseCase,
} from '../application/pricing.use-cases';

const quota = z.coerce.number().int().min(1).max(1_000_000);

export const createPriceSchema = z
  .strictObject({
    nom: text(80),
    prix: moneySchema,
    quota,
    dateDebutVente: dateSchema,
    dateFinVente: dateSchema,
    actif: z.boolean().default(true),
  })
  .refine((p) => p.dateFinVente > p.dateDebutVente, { message: 'période de vente invalide', path: ['dateFinVente'] });

export const updatePriceSchema = z
  .strictObject({
    nom: text(80).optional(),
    prix: moneySchema.optional(),
    quota: quota.optional(),
    dateDebutVente: dateSchema.optional(),
    dateFinVente: dateSchema.optional(),
    actif: z.boolean().optional(),
  })
  .refine((p) => Object.keys(p).length > 0, 'au moins un champ à modifier');

@Controller()
export class PricingController {
  constructor(
    private readonly listPrices: ListPricesUseCase,
    private readonly createPrice: CreatePriceUseCase,
    private readonly updatePrice: UpdatePriceUseCase,
    private readonly deletePrice: DeletePriceUseCase,
  ) {}

  @Get('events/:id/prices')
  list(@CurrentActor() actor: Actor | null, @Param('id', new ZodPipe(idSchema)) eventId: number) {
    return this.listPrices.execute(actor, eventId);
  }

  @Post('events/:id/prices')
  @Authenticated('organizer', 'admin')
  create(
    @CurrentActor() actor: Actor,
    @Param('id', new ZodPipe(idSchema)) eventId: number,
    @Body(new ZodPipe(createPriceSchema)) body: z.infer<typeof createPriceSchema>,
  ) {
    return this.createPrice.execute(actor, eventId, body);
  }

  @Patch('prices/:id')
  @Authenticated('organizer', 'admin')
  update(
    @CurrentActor() actor: Actor,
    @Param('id', new ZodPipe(idSchema)) id: number,
    @Body(new ZodPipe(updatePriceSchema)) body: z.infer<typeof updatePriceSchema>,
  ) {
    return this.updatePrice.execute(actor, id, body);
  }

  @Delete('prices/:id')
  @HttpCode(204)
  @Authenticated('organizer', 'admin')
  async remove(@CurrentActor() actor: Actor, @Param('id', new ZodPipe(idSchema)) id: number): Promise<void> {
    await this.deletePrice.execute(actor, id);
  }
}
