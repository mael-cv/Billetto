import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpStatus, Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PASSWORD_HASHER, type PasswordHasher } from '../../auth/domain/password-hasher';
import { APP_CONFIG, type AppConfig } from '../../common/config/config';
import { DbContextService } from '../../common/database/db-context.service';
import { ApiError } from '../../common/errors/http-errors';

export type SetupState = 'requis' | 'en_cours' | 'pret';

export interface SetupStatus {
  etat: SetupState;
  /** Mode de l'application une fois initialisée. */
  mode: 'test' | 'live' | null;
}

export interface SetupCommand {
  jeton: string;
  mode: 'test' | 'live';
  stripe?: { secretKey: string; webhookSecret: string };
  admin: { email: string; password: string; prenom: string; nom: string };
}

interface PendingRequest {
  mode: 'test' | 'live';
  admin: { email: string; passwordHash: string; prenom: string; nom: string };
  stripe: { secretKey: string; webhookSecret: string } | null;
}

/** Nombre de jetons erronés avant qu'un nouveau jeton remplace l'ancien. */
const MAX_TOKEN_FAILURES = 5;
const STRIPE_API = 'https://api.stripe.com/v1';

const parseEnv = (text: string): Record<string, string> => {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match?.[1] !== undefined) values[match[1]] = match[2] ?? '';
  }
  return values;
};

const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();

/**
 * Premier démarrage. L'API ne crée ni administrateur ni données : elle vérifie le
 * jeton d'installation, dépose une demande dans le volume de configuration, puis
 * attend que le conteneur d'installation (seul à disposer des droits propriétaire
 * sur la base) ait terminé. Elle complète alors sa configuration et s'arrête pour
 * redémarrer dans le mode choisi.
 */
@Injectable()
export class SetupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SetupService.name);
  private failures = 0;
  private submitting = false;
  private poller: NodeJS.Timeout | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    private readonly db: DbContextService,
  ) {}

  get required(): boolean {
    return this.config.APP_MODE === 'setup';
  }

  onModuleInit(): void {
    // Redémarrage pendant une installation en cours : on reprend l'attente.
    if (this.required && this.pendingExists()) this.watchCompletion();
  }

  onModuleDestroy(): void {
    if (this.poller) clearInterval(this.poller);
  }

  status(): SetupStatus {
    if (!this.required) return { etat: 'pret', mode: this.config.APP_MODE as 'test' | 'live' };
    return { etat: this.pendingExists() ? 'en_cours' : 'requis', mode: null };
  }

  async submit(command: SetupCommand): Promise<SetupStatus> {
    if (!this.required) throw alreadyDone();
    if (this.pendingExists() || this.submitting) {
      throw new ApiError(HttpStatus.CONFLICT, 'INSTALLATION_EN_COURS', 'L’installation est déjà en cours');
    }
    this.verifyToken(command.jeton);

    // Verrou : deux soumissions simultanées avec le bon jeton ne déposent qu'une demande.
    this.submitting = true;
    try {
      if (await this.initialisedInDatabase()) throw alreadyDone();

      const stripe = command.mode === 'live' ? await this.liveKeys(command) : this.testKeys(command);
      const request: PendingRequest = {
        mode: command.mode,
        admin: {
          email: command.admin.email.trim().toLowerCase(),
          passwordHash: await this.hasher.hash(command.admin.password),
          prenom: command.admin.prenom,
          nom: command.admin.nom,
        },
        stripe,
      };
      this.writeAtomic(this.path('setup-request.json'), JSON.stringify(request));
      // Jeton à usage unique : il disparaît dès que la demande est acceptée.
      rmSync(this.path('setup-token'), { force: true });
      this.logger.log(`installation demandée en mode ${command.mode}`);
      this.watchCompletion();
      return { etat: 'en_cours', mode: null };
    } finally {
      this.submitting = false;
    }
  }

  // ---------------------------------------------------------------------------

  private path(name: string): string {
    if (!this.config.CONFIG_DIR) {
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'INSTALLATION_INDISPONIBLE', 'Assistant d’installation indisponible');
    }
    return join(this.config.CONFIG_DIR, name);
  }

  private pendingExists(): boolean {
    return this.config.CONFIG_DIR !== undefined && existsSync(join(this.config.CONFIG_DIR, 'setup-request.json'));
  }

  /** Comparaison à temps constant sur des empreintes de même longueur. */
  private verifyToken(candidate: string): void {
    let expected = '';
    try {
      expected = readFileSync(this.path('setup-token'), 'utf8').trim();
    } catch {
      expected = '';
    }
    const valid = expected.length > 0 && timingSafeEqual(digest(candidate), digest(expected));
    if (valid) {
      this.failures = 0;
      return;
    }
    this.failures += 1;
    if (this.failures >= MAX_TOKEN_FAILURES) {
      this.failures = 0;
      const token = randomBytes(24).toString('base64url');
      this.writeAtomic(this.path('setup-token'), token);
      // Seul l'exploitant lit ces journaux : c'est le canal prévu pour le jeton.
      this.logger.warn(`trop de jetons d'installation erronés : nouveau jeton émis → ${token}`);
    }
    throw new ApiError(HttpStatus.FORBIDDEN, 'JETON_INVALIDE', 'Jeton d’installation invalide');
  }

  private testKeys(command: SetupCommand): PendingRequest['stripe'] {
    if (command.stripe) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION', 'Aucune clé Stripe n’est saisie en mode test');
    }
    const file = this.config.STRIPE_TEST_KEYS_FILE;
    if (!file || !existsSync(file)) return null;
    const values = parseEnv(readFileSync(file, 'utf8'));
    const secretKey = values.STRIPE_SECRET_KEY ?? '';
    const webhookSecret = values.STRIPE_WEBHOOK_SECRET ?? '';
    // Seules des clés de TEST sont acceptées depuis le fichier versionné.
    if (!/^(sk|rk)_test_[A-Za-z0-9]{16,}$/.test(secretKey) || !/^whsec_[A-Za-z0-9+/=_-]{24,}$/.test(webhookSecret)) {
      this.logger.warn('clés Stripe de test absentes ou invalides : paiement par carte désactivé');
      return null;
    }
    return { secretKey, webhookSecret };
  }

  private async liveKeys(command: SetupCommand): Promise<PendingRequest['stripe']> {
    if (!command.stripe) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION', 'Les clés Stripe sont requises en mode live');
    }
    // La clé est essayée auprès de Stripe avant d'être enregistrée.
    let response: Response;
    try {
      response = await fetch(`${STRIPE_API}/checkout/sessions?limit=1`, {
        headers: { authorization: `Bearer ${command.stripe.secretKey}` },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ApiError(HttpStatus.BAD_GATEWAY, 'PAIEMENT_INDISPONIBLE', 'Stripe est injoignable : clé non vérifiée');
    }
    if (!response.ok) {
      throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'CLE_STRIPE_INVALIDE', 'Clé Stripe refusée par Stripe');
    }
    return command.stripe;
  }

  private async initialisedInDatabase(): Promise<boolean> {
    const rows = await this.db.raw().$queryRaw<{ ok: boolean }[]>`SELECT application_initialisee() AS ok`;
    return rows[0]?.ok === true;
  }

  /** Attend que le conteneur d'installation ait initialisé la base, puis finalise. */
  private watchCompletion(): void {
    if (this.poller) return;
    this.poller = setInterval(() => {
      void this.initialisedInDatabase()
        .then((done) => {
          if (done) this.finalise();
        })
        .catch((err: Error) => this.logger.warn(`état d'installation illisible : ${err.message}`));
    }, 2_000);
    this.poller.unref();
  }

  private finalise(): void {
    if (this.poller) clearInterval(this.poller);
    this.poller = null;
    const request = JSON.parse(readFileSync(this.path('setup-request.json'), 'utf8')) as PendingRequest;
    const file = this.path('api.env');
    const values = parseEnv(readFileSync(file, 'utf8'));
    values.APP_MODE = request.mode;
    if (request.stripe) {
      values.STRIPE_SECRET_KEY = request.stripe.secretKey;
      values.STRIPE_WEBHOOK_SECRET = request.stripe.webhookSecret;
    }
    const content = `${Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')}\n`;
    this.writeAtomic(file, content);
    rmSync(this.path('setup-request.json'), { force: true });
    rmSync(this.path('setup-token'), { force: true });
    this.logger.log(`installation terminée (mode ${request.mode}) : redémarrage pour charger la configuration`);
    // L'orchestrateur relance le conteneur, qui démarre alors dans le mode choisi.
    setTimeout(() => process.exit(0), 500);
  }

  /** Écriture puis renommage : jamais de fichier de configuration à moitié écrit. */
  private writeAtomic(file: string, content: string): void {
    const tmp = `${file}.tmp-${randomBytes(6).toString('hex')}`;
    writeFileSync(tmp, content, { mode: 0o600 });
    renameSync(tmp, file);
  }
}

const alreadyDone = () =>
  new ApiError(HttpStatus.CONFLICT, 'DEJA_INITIALISEE', 'L’application est déjà initialisée');
