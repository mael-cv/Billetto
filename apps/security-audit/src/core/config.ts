/** Chargement + validation de la configuration (YAML) et fusion avec la CLI. */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { parse as parseYaml } from "yaml";
import { AuditError, ExitCode } from "./exit-codes";

export type ProfileName = "quick" | "standard" | "full";

export interface ProfileToggles {
  discovery: boolean;
  auth: boolean;
  authorization: boolean;
  fuzzing: boolean;
  bruteforce: boolean;
  injection: boolean;
  business_logic: boolean;
  resource_exhaustion: boolean;
  http_desync: boolean;
  whitebox: boolean;
}

export interface AuditConfig {
  target: {
    base_url: string;
    allowed_hosts: string[];
    proxy_url?: string;
    /** Routes documentées optionnelles (utile si le code n'est pas analysable). */
    routes?: Array<{ method: string; path: string; authRequired?: boolean; roles?: string[] }>;
  };
  repo_root: string;
  accounts: {
    password_env: string;
    password_default: string;
    user_a: string;
    organizer: string;
    admin: string;
    user_b_prefix: string;
  };
  lifecycle: {
    health_path: string;
    health_timeout_ms: number;
    start_command: string;
  };
  bruteforce: { enabled: boolean; max_attempts: number; concurrency: number; delay_ms: number };
  limits: { concurrency: number; max_requests: number; request_timeout_ms: number };
  scanners: Record<string, { enabled: boolean }>;
  secrets: { all_files: boolean };
  profiles: Record<ProfileName, ProfileToggles>;
  honeypots: Array<{ method?: string; path: string }>;
  security_gate: { fail_on: string[]; max_medium: number };
  output: { dir: string };

  // Résolu au chargement :
  _configDir: string;
  _profile: ProfileName;
}

const DEFAULT_CONFIG_FILE = resolve(__dirname, "..", "..", "security-audit.yaml");

export interface ConfigOverrides {
  configPath?: string;
  baseUrl?: string;
  profile?: ProfileName;
  startCommand?: string;
  allFiles?: boolean;
  concurrency?: number;
  maxRequests?: number;
  repoRoot?: string;
}

export function loadConfig(overrides: ConfigOverrides = {}): AuditConfig {
  const path = overrides.configPath ?? DEFAULT_CONFIG_FILE;
  if (!existsSync(path)) {
    throw new AuditError(`Fichier de configuration introuvable : ${path}`, ExitCode.CONFIG_ERROR);
  }
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(path, "utf8"));
  } catch (e) {
    throw new AuditError(`Config YAML invalide : ${(e as Error).message}`, ExitCode.CONFIG_ERROR);
  }
  const cfg = raw as AuditConfig;
  const configDir = dirname(resolve(path));

  // Overrides CLI.
  if (overrides.baseUrl) cfg.target.base_url = overrides.baseUrl;
  if (overrides.startCommand !== undefined) cfg.lifecycle.start_command = overrides.startCommand;
  if (overrides.allFiles !== undefined) cfg.secrets.all_files = overrides.allFiles;
  if (overrides.concurrency !== undefined) cfg.limits.concurrency = overrides.concurrency;
  if (overrides.maxRequests !== undefined) cfg.limits.max_requests = overrides.maxRequests;
  if (overrides.repoRoot) cfg.repo_root = overrides.repoRoot;

  cfg._configDir = configDir;
  cfg._profile = overrides.profile ?? "standard";

  validate(cfg);
  return cfg;
}

function validate(cfg: AuditConfig): void {
  if (!cfg.target?.base_url) {
    throw new AuditError("config.target.base_url manquant.", ExitCode.CONFIG_ERROR);
  }
  if (!Array.isArray(cfg.target.allowed_hosts) || cfg.target.allowed_hosts.length === 0) {
    throw new AuditError("config.target.allowed_hosts doit être une liste non vide.", ExitCode.CONFIG_ERROR);
  }
  if (!cfg.profiles?.[cfg._profile]) {
    throw new AuditError(`Profil inconnu : ${cfg._profile}`, ExitCode.CONFIG_ERROR);
  }
}

/** Résout un chemin relatif à la config (repo_root, output.dir). */
export function resolveFromConfig(cfg: AuditConfig, p: string): string {
  return resolve(cfg._configDir, p);
}

/** Mot de passe des comptes de test (env prioritaire, sinon défaut dev). */
export function accountPassword(cfg: AuditConfig): string {
  return process.env[cfg.accounts.password_env] ?? cfg.accounts.password_default;
}

export function activeProfile(cfg: AuditConfig): ProfileToggles {
  return cfg.profiles[cfg._profile];
}
