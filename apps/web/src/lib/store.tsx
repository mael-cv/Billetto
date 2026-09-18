import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { ModePaiement } from "./types";

// État purement d'interface : sélection de billets entre la page événement et le paiement,
// et notifications. Le prix affiché est indicatif : le montant débité est calculé par l'API.

/** Une commande porte sur un seul tarif (acheter_billet). */
export interface CartSelection {
  eventId: number;
  eventSlug: string;
  eventNom: string;
  eventDebut: string;
  eventImage: string;
  lieu: string;
  tarifId: number;
  tarifNom: string;
  prix: string;
  quantite: number;
  restantes: number;
  modePaiement: ModePaiement;
}

export interface Toast {
  id: number;
  message: string;
  tone: "success" | "error" | "info";
}

interface StoreCtx {
  cart: CartSelection | null;
  setCart: (selection: CartSelection | null) => void;
  toasts: Toast[];
  toast: (message: string, tone?: Toast["tone"]) => void;
  dismissToast: (id: number) => void;
}

const CART_KEY = "billetto:panier";
const Ctx = createContext<StoreCtx | null>(null);

function loadCart(): CartSelection | null {
  try {
    const raw = sessionStorage.getItem(CART_KEY);
    return raw ? (JSON.parse(raw) as CartSelection) : null;
  } catch {
    return null;
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  // Conservé en sessionStorage : la sélection survit à la redirection vers la connexion.
  const [cart, setCartState] = useState<CartSelection | null>(loadCart);
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    try {
      if (cart) sessionStorage.setItem(CART_KEY, JSON.stringify(cart));
      else sessionStorage.removeItem(CART_KEY);
    } catch {
      // stockage indisponible (navigation privée) : sélection en mémoire uniquement
    }
  }, [cart]);

  const toast = useCallback((message: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  return (
    <Ctx.Provider value={{ cart, setCart: setCartState, toasts, toast, dismissToast }}>{children}</Ctx.Provider>
  );
}

export function useStore() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useStore must be used within StoreProvider");
  return c;
}
