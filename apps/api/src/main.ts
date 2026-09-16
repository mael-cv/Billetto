import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: 100_000, trustProxy: false }),
  );
  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000', credentials: true });
  app.enableShutdownHooks();
  await app.listen(Number(process.env.API_PORT ?? 3001), '0.0.0.0');
}

void bootstrap();
