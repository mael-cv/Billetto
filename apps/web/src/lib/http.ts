// Client HTTP de l'API Billetto.
// - Session : cookie HttpOnly posé par l'API, envoyé automatiquement (credentials: "include").
// - CSRF : toute requête modifiante renvoie le jeton du cookie billetto_csrf dans X-CSRF-Token.
// - Erreurs : format unique de l'API converti en ApiError (status, code, message, détails).
// Aucune règle métier ici : quotas, prix, droits et visibilité sont décidés par l'API et PostgreSQL.

export const API_BASE: string = import.meta.env.VITE_API_URL ?? "/api/v1";

const CSRF_COOKIE = "billetto_csrf";

export interface FieldError {
  champ: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: FieldError[],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

export function buildQuery(query?: Query): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

export function readCookie(name: string, source: string = typeof document === "undefined" ? "" : document.cookie): string | null {
  for (const part of source.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

async function fetchCsrfToken(): Promise<string> {
  const res = await fetch(`${API_BASE}/auth/csrf`, { credentials: "include" });
  const data = (await res.json()) as { csrfToken: string };
  return data.csrfToken;
}

async function csrfToken(): Promise<string> {
  return readCookie(CSRF_COOKIE) ?? fetchCsrfToken();
}

interface RequestOptions {
  body?: unknown;
  query?: Query;
}

export async function http<T>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, options: RequestOptions = {}, retried = false): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") headers["X-CSRF-Token"] = await csrfToken();

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}${buildQuery(options.query)}`, {
      method,
      headers,
      credentials: "include",
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0, "RESEAU", "Impossible de joindre le serveur. Vérifiez votre connexion.");
  }

  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as
    | (T & { error?: string; message?: string; details?: FieldError[] })
    | null;

  if (!res.ok) {
    // Jeton CSRF expiré ou absent : on en redemande un et on rejoue une fois.
    if (res.status === 403 && data?.error === "CSRF_INVALIDE" && !retried) {
      await fetchCsrfToken();
      return http<T>(method, path, options, true);
    }
    throw new ApiError(res.status, data?.error ?? "ERREUR", data?.message ?? "Erreur inattendue", data?.details);
  }
  return data as T;
}

/** Message affichable pour une erreur quelconque. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "Une erreur inattendue est survenue.";
}
