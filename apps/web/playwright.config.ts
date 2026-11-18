import { defineConfig, devices } from "@playwright/test";

// Les parcours s'exécutent contre l'instance réellement déployée par
// « docker compose up -d » (HTTPS, certificat auto-signé) :
//   BASE_URL          adresse du front (défaut https://localhost:3000)
//   COMPOSE_PROJECT   projet Docker Compose, pour lire le jeton d'installation (défaut billetto)
// Instance vierge : le premier fichier (00-setup) déroule l'assistant de premier
// démarrage. Instance déjà initialisée hors de ces tests : fournir ADMIN_EMAIL et
// ADMIN_PASSWORD. Aucun identifiant n'est écrit dans le dépôt.
export default defineConfig({
  testDir: "./e2e",
  // Les routes d'authentification sont limitées à 10 requêtes par minute : les
  // parcours patientent quand il le faut (voir e2e/support.ts).
  timeout: 240_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false, // Exécution séquentielle : un seul état partagé sur l'instance
  workers: 1,
  retries: 0,
  use: {
    baseURL: process.env.BASE_URL ?? "https://localhost:3000",
    ignoreHTTPSErrors: true,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
