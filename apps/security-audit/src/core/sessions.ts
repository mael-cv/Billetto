/**
 * Gestion des sessions de test (flux Billetto : CSRF double-submit + login).
 * Un cookie jar + un jeton CSRF par rôle. JAMAIS de vrais credentials.
 */

import { CookieJar, type HttpClient } from "./http-client";
import { accountPassword, type AuditConfig } from "./config";
import type { Logger } from "./logger";

export type Role = "anon" | "user_a" | "user_b" | "organizer" | "admin";

export interface Session {
  role: Role;
  jar: CookieJar;
  csrfToken?: string;
  authenticated: boolean;
  email?: string;
  userId?: number;
}

const CSRF_COOKIE = "billetto_csrf";
const CSRF_HEADER = "X-CSRF-Token";

export class SessionManager {
  private readonly sessions = new Map<Role, Session>();

  constructor(
    private readonly cfg: AuditConfig,
    private readonly http: HttpClient,
    private readonly baseUrl: string,
    private readonly logger: Logger,
  ) {}

  /** Session anonyme (jar neuf, jeton CSRF frais). */
  anon(): Session {
    let s = this.sessions.get("anon");
    if (!s) {
      s = { role: "anon", jar: new CookieJar(), authenticated: false };
      this.sessions.set("anon", s);
    }
    return s;
  }

  get(role: Role): Session | undefined {
    return this.sessions.get(role);
  }

  /** Récupère un jeton CSRF frais pour une session (met à jour le jar). */
  async refreshCsrf(session: Session): Promise<string> {
    const res = await this.http.request({
      method: "GET",
      url: `${this.baseUrl}/auth/csrf`,
      cookieJar: session.jar,
      uncounted: true,
    });
    let token: string | undefined;
    try {
      token = (JSON.parse(res.body) as { csrfToken?: string }).csrfToken;
    } catch {
      /* ignore */
    }
    token = token ?? session.jar.get(CSRF_COOKIE);
    session.csrfToken = token;
    return token ?? "";
  }

  /** En-têtes pour une requête mutante (cookie jar géré séparément). */
  csrfHeaders(session: Session): Record<string, string> {
    return session.csrfToken ? { [CSRF_HEADER]: session.csrfToken } : {};
  }

  /** Connexion d'un compte de démo. Retourne la session (authenticated=false si échec). */
  async login(role: Exclude<Role, "anon" | "user_b">): Promise<Session> {
    const email = this.emailForRole(role);
    return this.loginWith(role, email, accountPassword(this.cfg));
  }

  /** Inscrit un USER_B (visitor) à chaud pour les tests IDOR horizontaux. */
  async registerUserB(): Promise<Session> {
    const existing = this.sessions.get("user_b");
    if (existing?.authenticated) return existing;

    const email = `${this.cfg.accounts.user_b_prefix}-${deterministicSuffix(this.baseUrl)}@billetto.test`;
    const password = accountPassword(this.cfg);
    const jar = new CookieJar();
    const session: Session = { role: "user_b", jar, authenticated: false, email };

    const csrf = await this.refreshCsrf(session);
    const res = await this.http.request({
      method: "POST",
      url: `${this.baseUrl}/auth/register`,
      cookieJar: jar,
      headers: { "content-type": "application/json", [CSRF_HEADER]: csrf },
      body: JSON.stringify({ email, password, prenom: "Pentest", nom: "UserB" }),
    });

    if (res.status === 201 || res.status === 200) {
      session.authenticated = true;
      await this.refreshCsrf(session);
    } else if (res.status === 409) {
      // Déjà inscrit : on se connecte.
      return this.loginWith("user_b", email, password);
    } else {
      this.logger.debug(`register USER_B → ${res.status}`);
    }
    this.sessions.set("user_b", session);
    return session;
  }

  private async loginWith(role: Role, email: string, password: string): Promise<Session> {
    const jar = new CookieJar();
    const session: Session = { role, jar, authenticated: false, email };
    const csrf = await this.refreshCsrf(session);
    const res = await this.http.request({
      method: "POST",
      url: `${this.baseUrl}/auth/login`,
      cookieJar: jar,
      headers: { "content-type": "application/json", [CSRF_HEADER]: csrf },
      body: JSON.stringify({ email, password }),
    });
    if (res.status === 200) {
      session.authenticated = true;
      try {
        const data = JSON.parse(res.body) as { user?: { id?: number }; csrfToken?: string };
        session.userId = data.user?.id;
        if (data.csrfToken) session.csrfToken = data.csrfToken;
      } catch {
        /* ignore */
      }
      await this.refreshCsrf(session);
    } else {
      this.logger.debug(`login ${email} → ${res.status}`);
    }
    this.sessions.set(role, session);
    return session;
  }

  private emailForRole(role: Exclude<Role, "anon" | "user_b">): string {
    switch (role) {
      case "user_a":
        return this.cfg.accounts.user_a;
      case "organizer":
        return this.cfg.accounts.organizer;
      case "admin":
        return this.cfg.accounts.admin;
    }
  }

  /** Tente de connecter tous les comptes nécessaires. Retourne ceux réussis. */
  async bootstrap(): Promise<Role[]> {
    const ok: Role[] = [];
    this.anon();
    ok.push("anon");
    for (const role of ["user_a", "organizer", "admin"] as const) {
      const s = await this.login(role);
      if (s.authenticated) ok.push(role);
    }
    const b = await this.registerUserB();
    if (b.authenticated) ok.push("user_b");
    return ok;
  }
}

/** Suffixe déterministe (pas de Math.random) pour l'email USER_B. */
function deterministicSuffix(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h.toString(36);
}
