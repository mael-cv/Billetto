import { startFixture, type Fixture } from "../../fixtures/vulnerable-app/server";
import { loadConfig, type AuditConfig } from "../../src/core/config";
import { Logger } from "../../src/core/logger";
import { runAudit } from "../../src/orchestrator";
import { resetFindingIds, type Category, type Finding } from "../../src/core/finding";

/**
 * Test d'acceptance : le moteur, lancé contre la fixture volontairement
 * vulnérable, doit retrouver CHAQUE vulnérabilité plantée, classer le honeypot,
 * et ne pas produire de faux positif sur la route saine.
 */
describe("acceptance : moteur vs fixture vulnérable", () => {
  let fixture: Fixture;
  let findings: Finding[];

  beforeAll(async () => {
    resetFindingIds();
    fixture = await startFixture();
    const config = buildConfig(fixture.baseUrl);
    const out = await runAudit(config, { pentest: true, whitebox: false, logger: new Logger("silent") });
    findings = out.findings;
  }, 60000);

  afterAll(async () => {
    if (fixture) await fixture.stop();
  });

  const real = () => findings.filter((f) => f.classification === "REAL_VULNERABILITY");
  const has = (c: Category) => real().some((f) => f.category === c);

  it.each([
    ["authorization", "IDOR/BOLA"],
    ["privilege-escalation", "missing authz admin"],
    ["cors", "bad CORS"],
    ["xss", "reflected XSS"],
    ["open-redirect", "unsafe redirect"],
    ["ssrf", "SSRF (callback local)"],
    ["file-upload", "upload non validé"],
    ["error-handling", "verbose error"],
    ["bruteforce", "weak rate limit"],
    ["api", "mass assignment"],
    ["injection", "SQL error"],
    ["cookies", "weak cookie"],
    ["account-enumeration", "account enumeration"],
  ])("détecte la catégorie %s (%s)", (category) => {
    expect(has(category as Category)).toBe(true);
  });

  it("classe le honeypot comme INTENTIONAL_HONEYPOT", () => {
    const honey = findings.filter((f) => f.classification === "INTENTIONAL_HONEYPOT");
    expect(honey.length).toBeGreaterThan(0);
    expect(honey.every((f) => (f.location.endpoint ?? "").includes("honeypot"))).toBe(true);
  });

  it("garde l'open redirect réel (hors honeypot) comme vulnérabilité réelle", () => {
    const realRedirects = real().filter((f) => f.category === "open-redirect");
    expect(realRedirects.some((f) => (f.location.endpoint ?? "").includes("/redirect") && !(f.location.endpoint ?? "").includes("honeypot"))).toBe(true);
  });

  it("ne produit aucun faux positif sur la route saine /public/ping", () => {
    expect(real().some((f) => (f.location.endpoint ?? "").includes("/public/ping"))).toBe(false);
  });

  it("produit des findings avec CVSS/CWE et des preuves", () => {
    for (const f of real()) {
      expect(f.cwe).toBeTruthy();
      expect(f.evidence.length + f.reproduction.length).toBeGreaterThan(0);
    }
  });
});

function buildConfig(baseUrl: string): AuditConfig {
  const config = loadConfig({ baseUrl, profile: "full" });
  config.target.proxy_url = undefined; // pas de seconde couche HTTP ici
  config.target.routes = [
    { method: "GET", path: "/api/v1/notes/me", authRequired: true },
    { method: "GET", path: "/api/v1/notes/:id", authRequired: true },
    { method: "GET", path: "/api/v1/admin/users", roles: ["admin"] },
    { method: "GET", path: "/api/v1/search" },
    { method: "GET", path: "/api/v1/redirect" },
    { method: "GET", path: "/api/v1/honeypot/redirect" },
    { method: "POST", path: "/api/v1/fetch" },
    { method: "POST", path: "/api/v1/upload" },
    { method: "GET", path: "/api/v1/public/ping" },
  ];
  config.accounts = {
    password_env: "FIXTURE_PW_UNUSED",
    password_default: "Fixture-Demo-2026!",
    user_a: "userA@fixture.test",
    organizer: "orga@fixture.test",
    admin: "admin@fixture.test",
    user_b_prefix: "pentest-userb",
  };
  config.honeypots = [{ method: "GET", path: "/api/v1/honeypot/redirect" }];
  // Scanners externes hors-scope du test.
  for (const k of Object.keys(config.scanners)) config.scanners[k] = { enabled: false };
  // Brute force rapide pour le test.
  config.bruteforce = { enabled: true, max_attempts: 5, concurrency: 1, delay_ms: 0 };
  return config;
}
