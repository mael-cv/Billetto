import { Module } from '@nestjs/common';
import { ReferentialController } from './referential.controller';

@Module({ controllers: [ReferentialController] })
export class ReferentialModule {}
