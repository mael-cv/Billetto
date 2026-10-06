import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import * as queue from "../lib/checkinQueue";
import type { LocalVerdict, PendingScan } from "../lib/checkinQueue";
import { formatTime } from "../lib/format";
import { useQueryParams } from "../lib/hooks";
import { ApiError } from "../lib/http";
import { useRouter } from "../lib/router";
import type { CheckinManifestEntry, ScanOutcome } from "../lib/types";
import { Button, EmptyState } from "../components/ui";
import { Page } from "../components/Layout";

// ---------------------------------------------------------------------------
// Check-in mobile-first, offline-first.
//   1. Chaque scan est d'abord écrit dans la file locale (lib/checkinQueue),
//      avec un clientScanId : rien n'est perdu si le réseau tombe.
//   2. Verdict immédiat calculé avec le manifeste (provisoire).
//   3. En ligne : envoi immédiat ; sinon synchronisation en arrière-plan
//      (événement online + toutes les 15 s) par lots idempotents.
//   4. Le serveur tranche (index unique en base) ; un désaccord avec le
//      verdict local est signalé comme conflit.
// ---------------------------------------------------------------------------

const SYNC_INTERVAL_MS = 15_000;
const SAME_CODE_COOLDOWN_MS = 3_000;
const BATCH_SIZE = 200;

// BarcodeDetector : Chrome/Edge Android et desktop. Absent d'iOS Safari et
// Firefox : saisie manuelle en repli.
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (options: { formats: string[] }) => BarcodeDetectorLike;
const BarcodeDetectorImpl = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;

type Tone = "ok" | "doublon" | "refus" | "attente";

interface Feedback {
  tone: Tone;
  title: string;
  detail?: string;
  provisional: boolean;
}

const manifestKey = (id: number) => `billetto:checkin-manifest:${id}`;

function readCachedManifest(id: number): CheckinManifestEntry[] | null {
  try {
    const raw = localStorage.getItem(manifestKey(id));
    return raw ? (JSON.parse(raw) as CheckinManifestEntry[]) : null;
  } catch {
    return null;
  }
}

function cacheManifest(id: number, entries: CheckinManifestEntry[]): void {
  try {
    localStorage.setItem(manifestKey(id), JSON.stringify(entries));
  } catch {
    // stockage indisponible : le manifeste reste en mémoire
  }
}

/** Erreur définitive (4xx) : inutile de réessayer. Réseau ou 5xx : on garde le scan en file. */
const isPermanent = (err: unknown) => err instanceof ApiError && err.status >= 400 && err.status < 500;

function deviceLabel(): string {
  try {
    const existing = localStorage.getItem("billetto:checkin-device");
    if (existing) return existing;
    const label = `appareil-${crypto.randomUUID().slice(0, 6)}`;
    localStorage.setItem("billetto:checkin-device", label);
    return label;
  } catch {
    return "appareil";
  }
}

function serverFeedback(outcome: ScanOutcome): Feedback {
  const who = [outcome.titulaire, outcome.tarif].filter(Boolean).join(" · ");
  switch (outcome.resultat) {
    case "ok":
      return { tone: "ok", title: "Entrée validée", detail: who, provisional: false };
    case "doublon": {
      const first = outcome.premierScan;
      const when = first ? `Déjà scanné à ${formatTime(first.scanneA)}${first.appareil ? ` (${first.appareil})` : ""}` : "Déjà scanné";
      return { tone: "doublon", title: "Billet déjà utilisé", detail: [when, who].filter(Boolean).join(" — "), provisional: false };
    }
    case "annule":
      return { tone: "refus", title: "Billet annulé ou remboursé", detail: who, provisional: false };
    case "mauvais_evenement":
      return { tone: "refus", title: "Billet d'un autre événement", detail: who, provisional: false };
    default:
      return { tone: "refus", title: "QR invalide", detail: "Signature non reconnue", provisional: false };
  }
}

function localFeedback(verdict: LocalVerdict, entry?: CheckinManifestEntry): Feedback {
  const who = entry ? `${entry.titulaire} · ${entry.tarif}` : undefined;
  if (verdict === "ok_provisoire") return { tone: "ok", title: "Entrée validée", detail: who, provisional: true };
  if (verdict === "doublon_local") return { tone: "doublon", title: "Billet déjà utilisé", detail: who, provisional: true };
  return { tone: "attente", title: "Billet inconnu hors ligne", detail: "Vérification à la synchronisation", provisional: true };
}

const TONE_CLASS: Record<Tone, string> = {
  ok: "bg-emerald-600 text-white",
  doublon: "bg-red-600 text-white",
  refus: "bg-amber-500 text-black",
  attente: "bg-slate-600 text-white",
};

export function CheckinPage() {
  const params = useQueryParams();
  const { navigate } = useRouter();
  const evenementId = Number(params.get("evenement"));
  const nom = params.get("nom") ?? `Événement n° ${evenementId}`;
  const valid = Number.isInteger(evenementId) && evenementId > 0;

  const [online, setOnline] = useState(() => navigator.onLine);
  const [manifest, setManifest] = useState<CheckinManifestEntry[] | null>(() => (valid ? readCachedManifest(evenementId) : null));
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(() => (valid ? queue.pending(evenementId).length : 0));
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [stats, setStats] = useState({ ok: 0, refus: 0 });
  const [manual, setManual] = useState("");
  const [cameraError, setCameraError] = useState<string | null>(BarcodeDetectorImpl ? null : "Scan caméra non pris en charge par ce navigateur : utilisez la saisie manuelle.");
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastCode = useRef<{ payload: string; at: number } | null>(null);
  const syncing = useRef(false);
  const device = useMemo(deviceLabel, []);

  const bySignature = useMemo(() => new Map((manifest ?? []).map((m) => [m.codeVerification, m])), [manifest]);
  // Verdicts locaux en attente de confirmation serveur, pour détecter les conflits.
  const provisional = useRef(new Map<string, LocalVerdict>());

  const refreshPending = useCallback(() => setPendingCount(queue.pending(evenementId).length), [evenementId]);

  const loadManifest = useCallback(async () => {
    if (!valid) return;
    try {
      const entries = await api.checkinManifest(evenementId);
      cacheManifest(evenementId, entries);
      setManifest(entries);
      setManifestError(null);
    } catch (err) {
      setManifestError(err instanceof ApiError && err.status !== 0 ? err.message : null);
    }
  }, [evenementId, valid]);

  const reconcile = useCallback((outcome: ScanOutcome) => {
    const local = provisional.current.get(outcome.clientScanId);
    provisional.current.delete(outcome.clientScanId);
    if (local === "ok_provisoire" && outcome.resultat !== "ok") {
      const f = serverFeedback(outcome);
      setConflicts((c) => [`${formatTime(outcome.scanneA)} — validé hors ligne, refusé par le serveur : ${f.title}${f.detail ? ` (${f.detail})` : ""}`, ...c].slice(0, 20));
    }
  }, []);

  /** Envoie la file par lots ; chaque scan acquitté (résultat ou erreur définitive) en sort. */
  const sync = useCallback(async () => {
    if (!valid || syncing.current || !navigator.onLine) return;
    syncing.current = true;
    try {
      let batch = queue.pending(evenementId).slice(0, BATCH_SIZE);
      while (batch.length > 0) {
        const results = await api.scanBatch(batch);
        queue.acknowledge(evenementId, results.map((r) => r.clientScanId));
        for (const r of results) if (r.status === "done") reconcile(r);
        batch = queue.pending(evenementId).slice(0, BATCH_SIZE);
      }
      void loadManifest();
    } catch (err) {
      // 4xx sur le lot entier (ex. session expirée) : on garde la file, l'utilisateur est averti.
      if (isPermanent(err)) setManifestError(err instanceof ApiError ? err.message : null);
    } finally {
      syncing.current = false;
      refreshPending();
    }
  }, [evenementId, valid, loadManifest, reconcile, refreshPending]);

  const show = useCallback((f: Feedback) => {
    setFeedback(f);
    if (f.tone === "ok") setStats((s) => ({ ...s, ok: s.ok + 1 }));
    else setStats((s) => ({ ...s, refus: s.refus + 1 }));
    try {
      navigator.vibrate?.(f.tone === "ok" ? 80 : [200, 80, 200]);
    } catch {
      // vibration non disponible
    }
  }, []);

  const handleScan = useCallback(
    async (raw: string) => {
      const payload = raw.trim();
      if (!payload || !valid) return;
      const now = Date.now();
      if (lastCode.current && lastCode.current.payload === payload && now - lastCode.current.at < SAME_CODE_COOLDOWN_MS) return;
      lastCode.current = { payload, at: now };

      const verdict = queue.localVerdict(payload, bySignature, queue.scannedSignatures(evenementId));
      const scan: PendingScan = queue.enqueue(evenementId, payload, device);
      refreshPending();
      const signature = queue.signatureOf(payload);

      if (!navigator.onLine) {
        provisional.current.set(scan.clientScanId, verdict);
        show(localFeedback(verdict, signature ? bySignature.get(signature) : undefined));
        return;
      }
      try {
        const outcome = await api.scan(scan);
        queue.acknowledge(evenementId, [scan.clientScanId]);
        show(serverFeedback(outcome));
      } catch (err) {
        if (isPermanent(err)) {
          queue.acknowledge(evenementId, [scan.clientScanId]);
          show({ tone: "refus", title: "Scan refusé", detail: err instanceof ApiError ? err.message : undefined, provisional: false });
        } else {
          // Réseau instable : le scan reste en file, verdict provisoire.
          provisional.current.set(scan.clientScanId, verdict);
          show(localFeedback(verdict, signature ? bySignature.get(signature) : undefined));
        }
      } finally {
        refreshPending();
      }
    },
    [bySignature, device, evenementId, refreshPending, show, valid],
  );

  // La boucle caméra lit toujours le dernier handler sans redémarrer le flux vidéo.
  const handleScanRef = useRef(handleScan);
  useEffect(() => {
    handleScanRef.current = handleScan;
  }, [handleScan]);

  // Connexion, manifeste, synchronisation en arrière-plan.
  useEffect(() => {
    if (!valid) return;
    const up = () => {
      setOnline(true);
      void sync();
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    void loadManifest().then(sync);
    const timer = window.setInterval(() => void sync(), SYNC_INTERVAL_MS);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      window.clearInterval(timer);
    };
  }, [valid, loadManifest, sync]);

  // Caméra arrière + détection continue.
  useEffect(() => {
    if (!valid || !BarcodeDetectorImpl) return;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let cancelled = false;
    const detector = new BarcodeDetectorImpl({ formats: ["qr_code"] });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (cancelled || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        timer = window.setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes[0]) void handleScanRef.current(codes[0].rawValue);
          } catch {
            // image illisible : on réessaie au tick suivant
          }
        }, 250);
      } catch {
        setCameraError("Caméra indisponible (autorisation refusée, ou page non servie en HTTPS). Utilisez la saisie manuelle.");
      }
    })();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [valid]);

  // Le retour visuel s'efface seul : le contrôleur enchaîne les scans.
  useEffect(() => {
    if (!feedback) return;
    const t = window.setTimeout(() => setFeedback(null), 2_500);
    return () => window.clearTimeout(t);
  }, [feedback]);

  if (!valid)
    return (
      <Page>
        <div className="pt-16">
          <EmptyState
            title="Choisissez un événement"
            message="Lancez le check-in depuis la liste de vos événements."
            action={<Button onClick={() => navigate("/organizer/events")}>Mes événements</Button>}
          />
        </div>
      </Page>
    );

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col bg-background">
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">Check-in</p>
          <h1 className="truncate font-display text-lg font-bold">{nom}</h1>
        </div>
        <span
          data-testid="checkin-network"
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${online ? "bg-emerald-600/15 text-emerald-500" : "bg-amber-500/20 text-amber-500"}`}
        >
          {online ? "En ligne" : "Hors ligne"}
          {pendingCount > 0 && ` · ${pendingCount} à synchroniser`}
        </span>
      </header>

      <div className="relative mx-4 aspect-square overflow-hidden rounded-[20px] bg-black">
        <video ref={videoRef} muted playsInline className="size-full object-cover" />
        {!feedback && <div className="pointer-events-none absolute inset-10 rounded-[16px] border-2 border-white/70" />}
        {cameraError && (
          <p className="absolute inset-x-4 top-1/2 -translate-y-1/2 text-center text-sm text-white/80">{cameraError}</p>
        )}
        {feedback && (
          <div
            role="status"
            data-testid="checkin-feedback"
            className={`absolute inset-0 flex flex-col items-center justify-center p-6 text-center ${TONE_CLASS[feedback.tone]}`}
          >
            <p className="font-display text-3xl font-extrabold">{feedback.title}</p>
            {feedback.detail && <p className="mt-2 text-base opacity-90">{feedback.detail}</p>}
            {feedback.provisional && <p className="mt-3 text-xs uppercase tracking-wide opacity-80">Provisoire · confirmé à la synchronisation</p>}
          </div>
        )}
      </div>

      <form
        className="mx-4 mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void handleScan(manual);
          setManual("");
        }}
      >
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="Coller le contenu du QR (BT1.…)"
          aria-label="Saisie manuelle du QR"
          className="min-w-0 flex-1 rounded-[12px] border border-border bg-card px-3 py-2.5 font-mono text-sm"
        />
        <Button type="submit" disabled={!manual.trim()}>
          Valider
        </Button>
      </form>

      <div className="mx-4 mt-4 grid grid-cols-3 gap-2 text-center text-sm">
        <div className="rounded-[12px] border border-border p-2">
          <div className="font-display text-xl font-bold text-emerald-500">{stats.ok}</div>
          <div className="text-xs text-muted-foreground">Entrées</div>
        </div>
        <div className="rounded-[12px] border border-border p-2">
          <div className="font-display text-xl font-bold text-red-500">{stats.refus}</div>
          <div className="text-xs text-muted-foreground">Refus</div>
        </div>
        <div className="rounded-[12px] border border-border p-2">
          <div className="font-display text-xl font-bold">{manifest ? manifest.length : "—"}</div>
          <div className="text-xs text-muted-foreground">Billets</div>
        </div>
      </div>

      {manifestError && <p className="mx-4 mt-3 text-sm text-red-500">{manifestError}</p>}
      {!manifest && !manifestError && (
        <p className="mx-4 mt-3 text-sm text-muted-foreground">
          Manifeste non chargé : hors ligne, tous les scans seront vérifiés à la synchronisation.
        </p>
      )}

      {conflicts.length > 0 && (
        <div className="mx-4 mt-4 rounded-[12px] border border-red-500/40 bg-red-500/10 p-3 text-sm" data-testid="checkin-conflicts">
          <p className="font-semibold text-red-500">Conflits détectés à la synchronisation</p>
          <ul className="mt-1 space-y-1 text-muted-foreground">
            {conflicts.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mx-4 my-4 flex gap-2">
        <Button variant="outline" className="flex-1" onClick={() => void sync()} disabled={!online || pendingCount === 0}>
          Synchroniser
        </Button>
        <Button variant="ghost" className="flex-1" onClick={() => navigate("/organizer/events")}>
          Quitter
        </Button>
      </div>
    </div>
  );
}
