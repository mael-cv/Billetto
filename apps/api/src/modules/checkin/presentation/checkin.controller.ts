import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { Actor } from '../../../auth/domain/actor';
import { Authenticated, CurrentActor } from '../../../auth/presentation/auth.decorators';
import { idSchema } from '../../../common/validation/schemas';
import { ZodPipe } from '../../../common/validation/zod.pipe';
import { CheckinManifestUseCase, ScanBatchUseCase, ScanTicketUseCase } from '../application/checkin.use-cases';

export const scanSchema = z.strictObject({
  clientScanId: z.uuid(),
  payload: z.string().trim().min(1).max(200),
  evenementId: idSchema,
  // Heure du téléphone au moment du scan (peut être ancienne pour un rejeu offline).
  scanneA: z.coerce.date(),
  appareil: z.string().trim().max(100).optional(),
});

export const scanBatchSchema = z.strictObject({
  scans: z.array(scanSchema).min(1).max(200),
});

export const manifestQuerySchema = z.strictObject({ evenementId: idSchema });

@Controller('checkin')
@Authenticated('organizer', 'admin')
export class CheckinController {
  constructor(
    private readonly scanTicket: ScanTicketUseCase,
    private readonly scanBatch: ScanBatchUseCase,
    private readonly manifestUseCase: CheckinManifestUseCase,
  ) {}

  @Post('scan')
  @HttpCode(200)
  scan(@CurrentActor() actor: Actor, @Body(new ZodPipe(scanSchema)) body: z.infer<typeof scanSchema>) {
    return this.scanTicket.execute(actor, body);
  }

  @Post('scan/batch')
  @HttpCode(200)
  batch(@CurrentActor() actor: Actor, @Body(new ZodPipe(scanBatchSchema)) body: z.infer<typeof scanBatchSchema>) {
    return this.scanBatch.execute(actor, body.scans);
  }

  @Get('manifest')
  manifest(@CurrentActor() actor: Actor, @Query(new ZodPipe(manifestQuerySchema)) query: z.infer<typeof manifestQuerySchema>) {
    return this.manifestUseCase.execute(actor, query.evenementId);
  }
}
