import 'reflect-metadata';
import { resolve } from 'node:path';
import { createApp } from './app.factory';
import { loadConfig } from './common/config/config';

async function bootstrap(): Promise<void> {
  try {
    // En conteneur : fichier du volume de configuration (BILLETTO_ENV_FILE), généré au
    // premier démarrage. En développement : .env à la racine (pnpm env:pull).
    process.loadEnvFile(process.env.BILLETTO_ENV_FILE ?? resolve(__dirname, '../../../.env'));
  } catch {
    // pas de fichier .env
  }
  const config = loadConfig();
  const app = await createApp(config);
  await app.listen(config.API_PORT, '0.0.0.0');
}

void bootstrap();
