import { assertSafeTarget, TargetSafetyError, isPrivateOrLoopback, assertSafeRedirect, hostAllowed } from "../../src/core/target-safety";
import { cvss31Score, severityFromScore, score, VECTORS } from "../../src/core/score";
import { dedupe } from "../../src/core/dedup";
import { toFinding, resetFindingIds, type FindingInput } from "../../src/core/finding";
import { CoverageRegistry } from "../../src/core/coverage";
import { redact, redactString, shannonEntropy } from "../../src/core/evidence";

const ALLOW = ["localhost", "127.0.0.1", "::1"];

describe("target-safety", () => {
  it("accepte localhost", async () => {
    const t = await assertSafeTarget("http://127.0.0.1:3001/api/v1", { allowedHosts: ALLOW });
    expect(t.hostname).toBe("127.0.0.1");
  });

  it("refuse une cible externe", async () => {
    await expect(assertSafeTarget("http://example.com/", { allowedHosts: ALLOW })).rejects.toBeInstanceOf(TargetSafetyError);
  });

  it("refuse un protocole non http(s)", async () => {
    await expect(assertSafeTarget("ftp://127.0.0.1/", { allowedHosts: ALLOW })).rejects.toBeInstanceOf(TargetSafetyError);
  });

  it("classe correctement les IP privées/loopback", () => {
    expect(isPrivateOrLoopback("127.0.0.1")).toBe(true);
    expect(isPrivateOrLoopback("10.0.0.5")).toBe(true);
    expect(isPrivateOrLoopback("192.168.1.1")).toBe(true);
    expect(isPrivateOrLoopback("8.8.8.8")).toBe(false);
    expect(isPrivateOrLoopback("::1")).toBe(true);
  });

  it("bloque un redirect sortant", () => {
    const base = new URL("http://127.0.0.1:3001/");
    expect(() => assertSafeRedirect("https://evil.example/x", base, ALLOW)).toThrow(TargetSafetyError);
    expect(assertSafeRedirect("/local", base, ALLOW).hostname).toBe("127.0.0.1");
  });

  it("hostAllowed respecte l'allowlist", () => {
    expect(hostAllowed("localhost", ALLOW)).toBe(true);
    expect(hostAllowed("evil.example", ALLOW)).toBe(false);
  });
});

describe("cvss", () => {
  it("calcule un score connu (bolaRead)", () => {
    const s = score(VECTORS.bolaRead);
    expect(s.cvss).toBeGreaterThan(5);
    expect(s.severity).toMatch(/HIGH|MEDIUM/);
  });

  it("mappe les seuils de sévérité", () => {
    expect(severityFromScore(9.1)).toBe("CRITICAL");
    expect(severityFromScore(7.5)).toBe("HIGH");
    expect(severityFromScore(5)).toBe("MEDIUM");
    expect(severityFromScore(2)).toBe("LOW");
    expect(severityFromScore(0)).toBe("INFO");
  });

  it("un vecteur sans impact donne 0", () => {
    expect(cvss31Score({ AV: "N", AC: "L", PR: "N", UI: "N", S: "U", C: "N", I: "N", A: "N" })).toBe(0);
  });
});

describe("dedup", () => {
  it("fusionne deux findings de même clé", () => {
    resetFindingIds();
    const base: FindingInput = {
      title: "x", severity: "MEDIUM", confidence: 0.5, status: "SUSPECTED", classification: "REAL_VULNERABILITY",
      category: "authorization", cwe: "CWE-639", source: "blackbox", location: { endpoint: "/a", method: "GET" },
      evidence: [{ note: "e1" }], reproduction: [], retestable: false,
    };
    const a = toFinding(base);
    const b = toFinding({ ...base, confidence: 0.9, evidence: [{ note: "e2" }] });
    const out = dedupe([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0]!.confidence).toBe(0.9);
    expect(out[0]!.evidence).toHaveLength(2);
  });
});

describe("coverage", () => {
  it("calcule un pourcentage en excluant NOT_APPLICABLE", () => {
    const c = new CoverageRegistry();
    c.set("authorization", "TESTED");
    c.set("ssrf", "NOT_APPLICABLE");
    c.set("xss", "NOT_TESTED");
    expect(c.percent()).toBe(50); // 1 TESTED / (TESTED + NOT_TESTED)
  });

  it("ne rétrograde pas un TESTED", () => {
    const c = new CoverageRegistry();
    c.set("cors", "TESTED");
    c.set("cors", "NOT_TESTED");
    expect(c.get("cors")!.status).toBe("TESTED");
  });
});

describe("evidence / redaction", () => {
  it("redacte les clés sensibles", () => {
    const out = redact({ password: "hunter2", email: "a@b.c", nested: { apiKey: "secret" } }) as Record<string, unknown>;
    expect(out.password).toBe("[REDACTED]");
    expect((out.nested as Record<string, unknown>).apiKey).toBe("[REDACTED]");
    expect(out.email).toBe("a@b.c");
  });

  it("redacte un JWT dans une chaîne", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjF9.abcDEF123456";
    expect(redactString(`token=${jwt}`)).toContain("[REDACTED_JWT]");
  });

  it("calcule une entropie plus haute pour une chaîne aléatoire", () => {
    expect(shannonEntropy("aaaaaaaa")).toBeLessThan(shannonEntropy("a9Xk2Lp7Qz"));
  });
});
