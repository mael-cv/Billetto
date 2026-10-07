import type { BlackboxContext } from "../../src/core/check";
import type { HttpResponse } from "../../src/core/http-client";
import { RouteModel } from "../../src/discovery/route-model";
import { csrfCheck, retryAfterMs } from "../../src/pentest/csrf";

function response(status: number, body = "", headers: Record<string, string> = {}): HttpResponse {
  return {
    status,
    statusText: "",
    headers,
    setCookies: [],
    body,
    bodyBytes: body.length,
    latencyMs: 1,
    url: "",
    method: "POST",
  };
}

/** Contexte minimal : une route mutante, réponses servies dans l'ordre. */
function ctxWith(responses: HttpResponse[]): BlackboxContext {
  const routes = new RouteModel();
  routes.add({ method: "POST", path: "/api/v1/tickets/purchase", params: [], origins: ["code"] });
  const queue = [...responses];
  return {
    baseUrl: "http://127.0.0.1:3001/api/v1",
    routes,
    sessions: { get: () => ({ role: "user_a", authenticated: true, jar: {} }) },
    http: { request: async () => queue.shift() ?? response(500) },
  } as unknown as BlackboxContext;
}

const RATE_LIMITED = response(429, '{"error":"TROP_DE_REQUETES"}', { "retry-after": "0" });

describe("csrf check", () => {
  it("403 CSRF → protégé, aucun finding", async () => {
    const res = await csrfCheck.run(ctxWith([response(403, '{"error":"CSRF_INVALIDE"}')]));
    expect(res.findings).toHaveLength(0);
    expect(res.coverage).toBe("TESTED");
  });

  it("429 persistant → non testé, aucun finding", async () => {
    const res = await csrfCheck.run(ctxWith([RATE_LIMITED, RATE_LIMITED]));
    expect(res.findings).toHaveLength(0);
    expect(res.coverage).toBe("INCONCLUSIVE");
    expect(res.coverageNote).toContain("rate-limit");
  });

  it("429 puis 403 CSRF → rejoué et protégé", async () => {
    const res = await csrfCheck.run(ctxWith([RATE_LIMITED, response(403, '{"error":"CSRF_INVALIDE"}')]));
    expect(res.findings).toHaveLength(0);
    expect(res.coverage).toBe("TESTED");
  });

  it("400 sans jeton → finding (validation atteinte)", async () => {
    const res = await csrfCheck.run(ctxWith([response(400, '{"error":"VALIDATION"}')]));
    expect(res.findings).toHaveLength(1);
  });

  it("retry-after borné", () => {
    expect(retryAfterMs("3")).toBe(3000);
    expect(retryAfterMs("600")).toBe(65_000);
    expect(retryAfterMs(undefined)).toBe(5000);
  });
});
