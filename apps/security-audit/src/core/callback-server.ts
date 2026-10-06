/**
 * Serveur de callback local pour confirmer un SSRF sans contacter Internet.
 * Le scanner injecte une URL pointant vers ce serveur ; si l'application cible
 * la requête, on enregistre le hit → SSRF confirmé, en restant 100 % local.
 */

import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

export interface CallbackHit {
  token: string;
  method: string;
  url: string;
  at: number;
}

export class CallbackServer {
  private server?: Server;
  private readonly hits: CallbackHit[] = [];
  private port = 0;

  async start(host = "127.0.0.1"): Promise<void> {
    if (this.server) return;
    this.server = createServer((req, res) => {
      const url = req.url ?? "/";
      const token = url.replace(/^\/+/, "").split(/[/?]/)[0] ?? "";
      this.hits.push({ token, method: req.method ?? "GET", url, at: this.hits.length });
      res.statusCode = 204;
      res.end();
    });
    await new Promise<void>((resolve) => {
      this.server!.listen(0, host, () => {
        this.port = (this.server!.address() as AddressInfo).port;
        resolve();
      });
    });
  }

  /** URL à injecter pour un token donné. */
  urlFor(token: string): string {
    return `http://127.0.0.1:${this.port}/${token}`;
  }

  /** Un hit a-t-il été reçu pour ce token ? */
  received(token: string): boolean {
    return this.hits.some((h) => h.token === token);
  }

  all(): CallbackHit[] {
    return [...this.hits];
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = undefined;
  }
}
