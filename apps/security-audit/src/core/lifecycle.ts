/**
 * Cycle de vie de l'application cible : detect → (start) → wait health → stop.
 * L'auto-start est optionnel (lifecycle.start_command). Si la cible répond déjà,
 * on ne lance rien et on ne l'arrête pas.
 */

import { spawn, type ChildProcess } from "node:child_process";
import type { AuditConfig } from "./config";
import type { HttpClient } from "./http-client";
import type { Logger } from "./logger";

export interface LifecycleHandle {
  /** true si l'app était déjà en route (on ne doit pas l'arrêter). */
  alreadyRunning: boolean;
  started: boolean;
  stop(): Promise<void>;
  logs(): string;
}

export class Lifecycle {
  private child?: ChildProcess;
  private logBuf = "";

  constructor(
    private readonly cfg: AuditConfig,
    private readonly http: HttpClient,
    private readonly baseUrl: string,
    private readonly logger: Logger,
  ) {}

  private healthUrl(): string {
    return `${this.baseUrl}${this.cfg.lifecycle.health_path}`;
  }

  /** Une seule sonde du health. true si 2xx. */
  async probe(): Promise<boolean> {
    try {
      const res = await this.http.request({
        method: "GET",
        url: this.healthUrl(),
        uncounted: true,
      });
      return res.status >= 200 && res.status < 300;
    } catch {
      return false;
    }
  }

  /** Attend que le health réponde, jusqu'au timeout. */
  async waitHealthy(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    let delay = 500;
    while (Date.now() < deadline) {
      if (await this.probe()) return true;
      await sleep(delay);
      delay = Math.min(delay * 1.5, 3000);
    }
    return false;
  }

  /**
   * Garantit que l'app est joignable : détection d'abord, auto-start sinon.
   * Lève via retour (handle.started=false, alreadyRunning=false) si injoignable.
   */
  async ensureUp(opts: { forceStart?: boolean } = {}): Promise<LifecycleHandle> {
    const noop: LifecycleHandle = {
      alreadyRunning: false,
      started: false,
      stop: async () => {},
      logs: () => this.logBuf,
    };

    if (!opts.forceStart && (await this.probe())) {
      this.logger.step(`Cible déjà joignable : ${this.baseUrl}`);
      return { ...noop, alreadyRunning: true };
    }

    const cmd = this.cfg.lifecycle.start_command.trim();
    if (!cmd) {
      this.logger.warn(
        `Cible injoignable et aucune lifecycle.start_command configurée : ${this.baseUrl}`,
      );
      return noop;
    }

    this.logger.step(`Auto-start : ${cmd}`);
    this.child = spawn(cmd, { shell: true, stdio: ["ignore", "pipe", "pipe"] });
    this.child.stdout?.on("data", (d: Buffer) => (this.logBuf += d.toString()));
    this.child.stderr?.on("data", (d: Buffer) => (this.logBuf += d.toString()));

    const healthy = await this.waitHealthy(this.cfg.lifecycle.health_timeout_ms);
    if (!healthy) {
      this.logger.error("L'application n'a pas démarré (health timeout).");
      await this.stop();
      return noop;
    }
    this.logger.step("Application démarrée et en bonne santé.");

    const self = this;
    return {
      alreadyRunning: false,
      started: true,
      async stop() {
        await self.stop();
      },
      logs: () => this.logBuf,
    };
  }

  private async stop(): Promise<void> {
    if (!this.child) return;
    const child = this.child;
    this.child = undefined;
    child.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolve) => child.once("exit", () => resolve())),
      sleep(5000),
    ]);
    if (!child.killed) child.kill("SIGKILL");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
