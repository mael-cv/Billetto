import { useEffect, useMemo, useState } from "react";
import { useRouter } from "./router";

/** Valeur retardée (recherche au fil de la frappe sans une requête par touche). */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/** Paramètres de la partie « ?… » de la route courante. */
export function useQueryParams(): URLSearchParams {
  const { path } = useRouter();
  return useMemo(() => new URLSearchParams(path.split("?")[1] ?? ""), [path]);
}

/** Début de journée courante en ISO, pour ne lister que les événements à venir. */
export function startOfToday(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
