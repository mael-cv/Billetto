import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from '../../auth/auth.module';
import { SetupController } from './setup.controller';
import { SetupGuard } from './setup.guard';
import { SetupService } from './setup.service';

/** Premier démarrage : assistant d'installation et verrou global tant qu'il n'est pas terminé. */
@Module({
  imports: [AuthModule],
  controllers: [SetupController],
  providers: [SetupService, { provide: APP_GUARD, useClass: SetupGuard }],
})
export class SetupModule {}
