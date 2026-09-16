import { Global, Module } from '@nestjs/common';
import { DbContextService } from './db-context.service';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService, DbContextService],
  exports: [DbContextService],
})
export class DatabaseModule {}
