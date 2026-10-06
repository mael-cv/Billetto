import { describe, expect, it } from "vitest";
import { acknowledge, enqueue, localVerdict, pending, scannedSignatures, signatureOf } from "../lib/checkinQueue";
import type { CheckinManifestEntry } from "../lib/types";

// Environnement node : pas de localStorage, la file retombe sur la mémoire
// (même chemin qu'un navigateur en navigation privée sans stockage).
const SIG_A = "AAAAAAAAAAAAAAAAAAAAAA";
const SIG_B = "BBBBBBBBBBBBBBBBBBBBBB";
const qr = (sig: string) => `BT1.8b0f6f8e-3f43-4b8a-9d6c-2f1f4b0a9e11.${sig}`;
const entry = (sig: string, dejaScanne = false): CheckinManifestEntry => ({
  billetId: 1,
  codeVerification: sig,
  tarif: "Standard",
  titulaire: "Camille P.",
  dejaScanne,
  scanneA: null,
});

describe("file de check-in offline", () => {
  it("extrait la signature d'un QR BT1, rejette les autres formats", () => {
    expect(signatureOf(` ${qr(SIG_A)} `)).toBe(SIG_A);
    expect(signatureOf("BT1.pas-un-uuid.AAAAAAAAAAAAAAAAAAAAAA")).toBeNull();
    expect(signatureOf("https://example.com")).toBeNull();
  });

  it("verdict local : provisoire ok, doublon (manifeste ou appareil), inconnu", () => {
    const manifest = new Map([
      [SIG_A, entry(SIG_A)],
      [SIG_B, entry(SIG_B, true)],
    ]);
    expect(localVerdict(qr(SIG_A), manifest, new Set())).toBe("ok_provisoire");
    expect(localVerdict(qr(SIG_A), manifest, new Set([SIG_A]))).toBe("doublon_local");
    expect(localVerdict(qr(SIG_B), manifest, new Set())).toBe("doublon_local");
    expect(localVerdict(qr("CCCCCCCCCCCCCCCCCCCCCC"), manifest, new Set())).toBe("inconnu");
  });

  it("chaque scan a son propre clientScanId ; l'acquittement retire seulement les scans reçus", () => {
    const evt = 101;
    const a = enqueue(evt, qr(SIG_A), "porte A", new Date("2026-10-06T20:00:00Z"));
    const b = enqueue(evt, qr(SIG_A), "porte A");
    expect(a.clientScanId).not.toBe(b.clientScanId);
    expect(a.scanneA).toBe("2026-10-06T20:00:00.000Z");
    expect(pending(evt)).toHaveLength(2);
    expect(scannedSignatures(evt)).toEqual(new Set([SIG_A]));

    acknowledge(evt, [b.clientScanId, "inconnu"]);
    expect(pending(evt).map((s) => s.clientScanId)).toEqual([a.clientScanId]);
    // Acquitter deux fois (réponse rejouée) est sans effet.
    acknowledge(evt, [b.clientScanId]);
    expect(pending(evt)).toHaveLength(1);
  });

  it("files isolées par événement", () => {
    enqueue(201, qr(SIG_A));
    expect(pending(202)).toEqual([]);
  });
});
