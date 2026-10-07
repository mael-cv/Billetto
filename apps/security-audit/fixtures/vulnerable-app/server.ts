/**
 * Application VOLONTAIREMENT VULNÉRABLE — laboratoire de validation du moteur.
 * Isolée : aucun vrai credential, aucune vraie base, aucun accès réseau externe
 * (sauf le fetch SSRF, dirigé uniquement vers le callback local du scanner).
 *
 * Vulnérabilités plantées : missing authz, IDOR, weak rate limit, reflected XSS,
 * bad CORS, verbose error, unsafe redirect, weak cookie, mass assignment,
 * upload non validé, SSRF, + une route honeypot.
 */

import { createServer, get as httpGet, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

interface User {
  id: number;
  email: string;
  role: string;
  password: string;
}

export interface Fixture {
  port: number;
  origin: string;
  baseUrl: string;
  stop(): Promise<void>;
}

// security-audit-ignore: generic-secret -- compte de la fixture vulnérable (tests d'acceptance, jamais déployée)
const DEMO_PASSWORD = "Fixture-Demo-2026!";

export async function startFixture(password = DEMO_PASSWORD): Promise<Fixture> {
  const users = new Map<string, User>();
  let nextId = 1;
  const sessions = new Map<string, number>(); // token → userId

  // Comptes de démo.
  for (const [email, role] of [
    ["userA@fixture.test", "visitor"],
    ["admin@fixture.test", "admin"],
    ["orga@fixture.test", "organizer"],
  ] as const) {
    users.set(email, { id: nextId++, email, role, password });
  }

  const server = createServer((req, res) => handle(req, res, users, sessions, () => nextId++, password));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  return {
    port,
    origin,
    baseUrl: `${origin}/api/v1`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function handle(
  req: IncomingMessage,
  res: ServerResponse,
  users: Map<string, User>,
  sessions: Map<string, number>,
  nextId: () => number,
  password: string,
): void {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const path = url.pathname;
  const method = req.method ?? "GET";

  // VULN bad CORS : reflète l'Origin + credentials sur toutes les réponses.
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }

  const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
    const payload = typeof body === "string" ? body : JSON.stringify(body);
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    if (!res.hasHeader("content-type")) res.setHeader("content-type", "application/json");
    res.statusCode = status;
    res.end(payload);
  };

  readBody(req).then((raw) => {
    const body = parseJson(raw);
    const currentUser = sessionUser(req, sessions, users);

    // --- Health ---
    if (path === "/api/v1/health") return send(200, { status: "ok" });

    // --- Auth ---
    if (path === "/api/v1/auth/csrf" && method === "GET") {
      // VULN weak cookie : cookie "auth_token" sans HttpOnly/Secure/SameSite.
      // security-audit-ignore: generic-secret -- jeton CSRF fixe volontaire de la fixture vulnérable
      return send(200, { csrfToken: "fixture-csrf-token" }, {
        "set-cookie": "auth_token=abc123; Path=/",
      });
    }
    if (path === "/api/v1/auth/register" && method === "POST") {
      const email = String(body.email ?? "");
      if (users.has(email)) return send(409, { error: "EMAIL_EXISTS" }); // VULN account enumeration
      // VULN mass assignment : role/isAdmin acceptés depuis le corps.
      const role = body.isAdmin === true ? "admin" : typeof body.role === "string" ? body.role : "visitor";
      const u: User = { id: nextId(), email, role, password: String(body.password ?? "") };
      users.set(email, u);
      const token = `sess-${u.id}`;
      sessions.set(token, u.id);
      return send(201, { user: publicUser(u) }, { "set-cookie": `fixture_session=${token}; Path=/` });
    }
    if (path === "/api/v1/auth/login" && method === "POST") {
      const u = users.get(String(body.email ?? ""));
      // VULN account enumeration : message différent selon l'existence.
      if (!u) return send(401, { error: "USER_NOT_FOUND", message: "no such account" });
      if (u.password !== String(body.password ?? "")) return send(401, { error: "WRONG_PASSWORD", message: "bad password" });
      const token = `sess-${u.id}`;
      sessions.set(token, u.id);
      return send(200, { user: publicUser(u), csrfToken: "fixture-csrf-token" }, { "set-cookie": `fixture_session=${token}; Path=/` });
    }
    if (path === "/api/v1/auth/logout" && method === "POST") {
      return send(204, "", { "set-cookie": "fixture_session=; Path=/; Max-Age=0" });
    }
    if (path === "/api/v1/auth/me" && method === "GET") {
      if (!currentUser) return send(401, { error: "UNAUTH" });
      return send(200, { user: publicUser(currentUser) });
    }

    // --- IDOR / missing authz : /notes/:id lisible par tous ---
    if (path === "/api/v1/notes/me" && method === "GET") {
      if (!currentUser) return send(401, { error: "UNAUTH" });
      return send(200, { items: [{ id: currentUser.id, title: `note de ${currentUser.email}` }] });
    }
    const noteMatch = path.match(/^\/api\/v1\/notes\/(\d+)$/);
    if (noteMatch && method === "GET") {
      const id = Number(noteMatch[1]);
      // VULN IDOR + missing authz : aucun contrôle de propriété ni d'auth.
      return send(200, { id, title: `note ${id}`, secret: `contenu privé ${id}` });
    }

    // --- Privesc / missing authz : /admin/users sans contrôle de rôle ---
    if (path === "/api/v1/admin/users" && method === "GET") {
      return send(200, { items: [...users.values()].map(publicUser) }); // VULN : accessible à tous
    }

    // --- Reflected XSS + injection error ---
    if (path === "/api/v1/search" && method === "GET") {
      const q = url.searchParams.get("q") ?? "";
      if (q.includes("'")) {
        // VULN verbose error / SQL injection signal.
        return send(500, `Database error: syntax error at or near "'" in query: SELECT * FROM notes WHERE title='${q}'\n    at Query.run (/app/db.js:42:15)`, { "content-type": "text/plain" });
      }
      // VULN reflected XSS : q réfléchi non encodé dans du HTML.
      return send(200, `<html><body>Résultats pour ${q}</body></html>`, { "content-type": "text/html" });
    }

    // --- Open redirect ---
    if (path === "/api/v1/redirect" && method === "GET") {
      const target = url.searchParams.get("url") ?? url.searchParams.get("next") ?? "/";
      return send(302, "", { location: target }); // VULN : redirige vers une URL arbitraire
    }

    // --- SSRF : fetch côté serveur de l'URL fournie ---
    if (path === "/api/v1/fetch" && method === "POST") {
      const target = String(body.url ?? body.webhook ?? body.callback ?? "");
      if (target.startsWith("http://")) {
        try {
          httpGet(target, (r) => r.resume()).on("error", () => {});
        } catch {
          /* ignore */
        }
      }
      return send(200, { fetched: true });
    }

    // --- Upload non validé ---
    if (path === "/api/v1/upload" && method === "POST") {
      return send(200, { stored: true, note: "aucune validation MIME/extension" }); // VULN
    }

    // --- Honeypot (volontairement vulnérable, doit être classé INTENTIONAL) ---
    // Open redirect piégé : un check le détectera, mais il doit être classé
    // INTENTIONAL_HONEYPOT et exclu du décompte des vulnérabilités réelles.
    if (path === "/api/v1/honeypot/redirect" && method === "GET") {
      const target = url.searchParams.get("url") ?? "/";
      return send(302, "", { location: target });
    }
    if (path === "/api/v1/honeypot/secret" && method === "GET") {
      // security-audit-ignore: generic-secret -- honeypot : faux secret exposé exprès
      return send(200, { fakeApiKey: "HONEYPOT-not-a-real-secret" });
    }

    // --- Route saine (contrôle des faux positifs) ---
    if (path === "/api/v1/public/ping" && method === "GET") {
      res.setHeader("content-security-policy", "default-src 'none'");
      res.setHeader("x-content-type-options", "nosniff");
      return send(200, { pong: true });
    }

    // VULN verbose error sur route inconnue : fuite de stack trace.
    return send(404, `Not found: ${path}\n    at Router.handle (/app/router.js:88:12)\n    at Server.<anonymous> (/app/server.js:12:5)`, { "content-type": "text/plain" });
  });
}

function publicUser(u: User): { id: number; email: string; role: string } {
  return { id: u.id, email: u.email, role: u.role };
}

function sessionUser(req: IncomingMessage, sessions: Map<string, number>, users: Map<string, User>): User | undefined {
  const cookie = req.headers.cookie ?? "";
  const m = cookie.match(/fixture_session=([^;]+)/);
  if (!m) return undefined;
  const uid = sessions.get(m[1] ?? "");
  if (uid === undefined) return undefined;
  return [...users.values()].find((u) => u.id === uid);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", () => resolve(data));
  });
}

function parseJson(raw: string): Record<string, unknown> {
  try {
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// Permet un lancement autonome : `tsx fixtures/vulnerable-app/server.ts`
if (require.main === module) {
  startFixture().then((f) => {
    process.stdout.write(`Fixture vulnérable sur ${f.baseUrl}\n`);
  });
}
