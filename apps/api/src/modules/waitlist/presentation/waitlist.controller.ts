import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import type { Actor } from '../../../auth/domain/actor';
import { Authenticated, CurrentActor } from '../../../auth/presentation/auth.decorators';
import { idSchema } from '../../../common/validation/schemas';
import { ZodPipe } from '../../../common/validation/zod.pipe';
import {
  CancelWaitlistUseCase,
  ConfirmWaitlistUseCase,
  JoinWaitlistUseCase,
  ListMyWaitlistUseCase,
  TarifWaitlistUseCase,
} from '../application/waitlist.use-cases';

export const joinWaitlistSchema = z.strictObject({
  tarifId: idSchema,
  // Bornes également vérifiées par inscrire_liste_attente (BT007).
  quantite: z.coerce.number().int().min(1).max(10),
});

@Controller('waitlist')
@Authenticated()
export class WaitlistController {
  constructor(
    private readonly joinWaitlist: JoinWaitlistUseCase,
    private readonly listMine: ListMyWaitlistUseCase,
    private readonly confirmWaitlist: ConfirmWaitlistUseCase,
    private readonly cancelWaitlist: CancelWaitlistUseCase,
    private readonly tarifWaitlist: TarifWaitlistUseCase,
  ) {}

  @Post()
  @HttpCode(201)
  join(@CurrentActor() actor: Actor, @Body(new ZodPipe(joinWaitlistSchema)) body: z.infer<typeof joinWaitlistSchema>) {
    return this.joinWaitlist.execute(actor, body.tarifId, body.quantite);
  }

  @Get('me')
  me(@CurrentActor() actor: Actor) {
    return this.listMine.execute(actor);
  }

  @Get('tarifs/:tarifId')
  @Authenticated('organizer', 'admin')
  queue(@CurrentActor() actor: Actor, @Param('tarifId', new ZodPipe(idSchema)) tarifId: number) {
    return this.tarifWaitlist.execute(actor, tarifId);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  confirm(@CurrentActor() actor: Actor, @Param('id', new ZodPipe(idSchema)) id: number) {
    return this.confirmWaitlist.execute(actor, id);
  }

  @Delete(':id')
  @HttpCode(204)
  async cancel(@CurrentActor() actor: Actor, @Param('id', new ZodPipe(idSchema)) id: number): Promise<void> {
    await this.cancelWaitlist.execute(actor, id);
  }
}
