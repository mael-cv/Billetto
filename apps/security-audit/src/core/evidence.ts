/**
 * Capture de preuves + REDACTION systématique. On ne stocke jamais en clair :
 * mot de passe, token, clé API, cookie de session, JWT, secret, signature.
 */

const SENSITIVE_HEADERS = new Set([
  "cookie",
  "set-cookie",
  "authorization",
  "x-csrf-token",
  "x-billetto-signature",
  "proxy-authorization",
]);

const SENSITIVE_KEY = /pass|secret|token|api[-_]?key|authorization|cookie|signature|credential|jwt/i;

// Motifs de valeurs à redacter même hors clé connue.
const JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const PRIVKEY_RE =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const LONG_TOKEN_RE = /\b[A-Za-z0-9+/=_-]{32,}\b/g;

function looksLikeSecret(s: string): boolean {
  // Longue chaîne à haute entropie → probable secret.
  if (s.length < 32) return false;
  return shannonEntropy(s) > 3.5;
}

export function shannonEntropy(s: string): number {
  if (!s) return 0;
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const c of freq.values()) {
    const p = c / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

export function redactString(value: string): string {
  let out = value.replace(PRIVKEY_RE, "[REDACTED_PRIVATE_KEY]");
  out = out.replace(JWT_RE, "[REDACTED_JWT]");
  out = out.replace(LONG_TOKEN_RE, (m) => (looksLikeSecret(m) ? "[REDACTED_SECRET]" : m));
  return out;
}

/** Redacte récursivement un objet (headers, body metadata, snippets). */
export function redact<T>(value: T): T {
  if (value == null) return value;
  if (typeof value === "string") return redactString(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redact(v)) as unknown as T;
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_HEADERS.has(k.toLowerCase()) || SENSITIVE_KEY.test(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redact(v);
      }
    }
    return out as unknown as T;
  }
  return value;
}

/** Filtre un objet d'en-têtes : redacte les sensibles, garde les autres. */
export function redactHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined) continue;
    const val = Array.isArray(v) ? v.join(", ") : v;
    out[k] = SENSITIVE_HEADERS.has(k.toLowerCase()) ? "[REDACTED]" : redactString(val);
  }
  return out;
}
