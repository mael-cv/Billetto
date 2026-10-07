import type { FindingInput } from "../../src/core/finding";
import { applySuppression, findSuppression } from "../../src/whitebox/suppression";

const finding: FindingInput = {
  title: "Utilisation de child_process",
  severity: "LOW",
  confidence: 0.6,
  status: "SUSPECTED",
  classification: "REAL_VULNERABILITY",
  category: "sast",
  source: "whitebox",
  location: { file: "x.mjs", line: 2 },
  evidence: [],
  reproduction: [],
  retestable: false,
};

describe("suppression security-audit-ignore", () => {
  it("marqueur justifié sur la ligne précédente → FALSE_POSITIVE", () => {
    const lines = ["// security-audit-ignore: child-process -- argv, aucune entrée externe", "spawnSync('docker', args)"];
    const out = applySuppression(finding, lines, 1, "child-process", "x.mjs");
    expect(out).toHaveLength(1);
    expect(out[0]?.status).toBe("FALSE_POSITIVE");
    expect(out[0]?.classification).toBe("FALSE_POSITIVE");
    expect(out[0]?.evidence.at(-1)?.note).toContain("argv, aucune entrée externe");
  });

  it("marqueur sur la même ligne et liste de règles", () => {
    const lines = ["const s = 'x'; // security-audit-ignore: jwt, generic-secret -- valeur de test"];
    expect(findSuppression(lines, 0, "generic-secret")).toEqual({ kind: "justified", reason: "valeur de test", line: 1 });
  });

  it("marqueur pour une autre règle → ignoré", () => {
    const lines = ["// security-audit-ignore: eval -- raison", "spawnSync('docker', args)"];
    expect(applySuppression(finding, lines, 1, "child-process", "x.mjs")).toEqual([finding]);
  });

  it("marqueur sans raison → finding conservé + INFO", () => {
    const lines = ["// security-audit-ignore: child-process", "spawnSync('docker', args)"];
    const out = applySuppression(finding, lines, 1, "child-process", "x.mjs");
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(finding);
    expect(out[1]?.severity).toBe("INFO");
    expect(out[1]?.title).toMatch(/sans justification/);
  });

  it("ne regarde pas au-delà de la ligne précédente", () => {
    const lines = ["// security-audit-ignore: child-process -- raison", "", "spawnSync('docker', args)"];
    expect(findSuppression(lines, 2, "child-process")).toBeUndefined();
  });
});
