/**
 * Client HTTP sûr pour le pentest : redirect manuel (jamais suivi silencieusement
 * vers l'extérieur), timeouts courts, concurrence bornée, plafond de requêtes,
 * capture de métadonnées req/resp. S'appuie sur fetch (Node 20+/22).
 */

import { assertSafeRedirect, hostAllowed } from "./target-safety";
import type { Logger } from "./logger";

export interface HttpClientOptions {
  allowedHosts: string[];
  concurrency: number;
  maxRequests: number;
  timeoutMs: number;
  logger?: Logger;
}

export interface HttpRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  /** Jar de cookies à envoyer/mettre à jour (clé=valeur). */
  cookieJar?: CookieJar;
  /** Nombre max de redirects à suivre (tous doivent rester dans l'allowlist). */
  maxRedirects?: number;
  /** Ne pas compter cette requête dans le plafond (ex. health probe). */
  uncounted?: boolean;
}

export interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  setCookies: string[];
  body: string;
  bodyBytes: number;
  latencyMs: number;
  redirectedTo?: string;
  url: string;
  method: string;
}

/** Jar de cookies très simple (nom → valeur), suffisant pour une session. */
export class CookieJar {
  private readonly cookies = new Map<string, string>();

  setFromHeaders(setCookies: string[]): void {
    for (const sc of setCookies) {
      const first = sc.split(";")[0] ?? "";
      const eq = first.indexOf("=");
      if (eq <= 0) continue;
      const name = first.slice(0, eq).trim();
      const value = first.slice(eq + 1).trim();
      if (/^(deleted|)$/i.test(value) && /max-age=0|expires=/i.test(sc) && value === "") {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }

  get(name: string): string | undefined {
    return this.cookies.get(name);
  }

  header(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  clone(): CookieJar {
    const j = new CookieJar();
    for (const [k, v] of this.cookies) j["cookies"].set(k, v);
    return j;
  }

  clear(): void {
    this.cookies.clear();
  }
}

export class RequestBudgetExceeded extends Error {
  constructor(max: number) {
    super(`Plafond de requêtes atteint (${max}).`);
    this.name = "RequestBudgetExceeded";
  }
}

export class HttpClient {
  private inFlight = 0;
  private queue: Array<() => void> = [];
  private count = 0;

  constructor(private readonly opts: HttpClientOptions) {}

  requestsMade(): number {
    return this.count;
  }

  async request(req: HttpRequest): Promise<HttpResponse> {
    if (!req.uncounted) {
      if (this.count >= this.opts.maxRequests) {
        throw new RequestBudgetExceeded(this.opts.maxRequests);
      }
      this.count += 1;
    }
    await this.acquire();
    try {
      return await this.doRequest(req, req.maxRedirects ?? 0);
    } finally {
      this.release();
    }
  }

  private async doRequest(req: HttpRequest, redirectsLeft: number): Promise<HttpResponse> {
    const headers: Record<string, string> = { ...(req.headers ?? {}) };
    if (req.cookieJar) {
      const cookie = req.cookieJar.header();
      if (cookie) headers["cookie"] = cookie;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    const start = Date.now();
    let res: Response;
    try {
      res = await fetch(req.url, {
        method: req.method,
        headers,
        body: req.body,
        redirect: "manual",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const latencyMs = Date.now() - start;

    const setCookies = extractSetCookies(res.headers);
    if (req.cookieJar) req.cookieJar.setFromHeaders(setCookies);

    const bodyText = await res.text();
    const respHeaders = headersToObject(res.headers);

    const response: HttpResponse = {
      status: res.status,
      statusText: res.statusText,
      headers: respHeaders,
      setCookies,
      body: bodyText,
      bodyBytes: Buffer.byteLength(bodyText),
      latencyMs,
      url: req.url,
      method: req.method,
    };

    // Redirect : jamais suivi silencieusement vers l'extérieur.
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (location) {
        const base = new URL(req.url);
        // On enregistre toujours la destination brute (utile pour détecter un
        // open redirect), sans jamais la SUIVRE si elle sort de l'allowlist.
        let destUrl: URL | undefined;
        try {
          destUrl = new URL(location, base);
          response.redirectedTo = destUrl.toString();
        } catch {
          response.redirectedTo = location;
        }
        if (redirectsLeft > 0 && destUrl) {
          // Ne suit que si la destination reste dans l'allowlist (sinon on lève).
          const dest = assertSafeRedirect(location, base, this.opts.allowedHosts);
          if (hostAllowed(dest.hostname, this.opts.allowedHosts)) {
            const nextMethod = res.status === 303 ? "GET" : req.method;
            return this.doRequest(
              { ...req, url: dest.toString(), method: nextMethod, uncounted: true },
              redirectsLeft - 1,
            );
          }
        }
      }
    }
    return response;
  }

  private acquire(): Promise<void> {
    if (this.inFlight < this.opts.concurrency) {
      this.inFlight += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.inFlight += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.inFlight -= 1;
    const next = this.queue.shift();
    if (next) next();
  }
}

function extractSetCookies(headers: Headers): string[] {
  // Node fetch expose getSetCookie() (undici).
  const anyHeaders = headers as unknown as { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === "function") return anyHeaders.getSetCookie();
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}
