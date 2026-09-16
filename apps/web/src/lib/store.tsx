import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

// Front-end only cart selection + toast + session mock. Persists the checkout
// selection between the event page and checkout. No pricing/inventory logic.

export interface CartItem {
  eventSlug: string;
  eventNom: string;
  eventImage: string;
  tarifId: string;
  tarifNom: string;
  prix: number;
  quantite: number;
}

export interface Toast {
  id: number;
  message: string;
  tone: "success" | "error" | "info";
}

interface StoreCtx {
  cart: CartItem[];
  setSelection: (items: CartItem[]) => void;
  clearCart: () => void;
  user: { prenom: string; email: string } | null;
  signIn: (prenom: string, email: string) => void;
  signOut: () => void;
  toasts: Toast[];
  toast: (message: string, tone?: Toast["tone"]) => void;
  dismissToast: (id: number) => void;
}

const Ctx = createContext<StoreCtx | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [user, setUser] = useState<{ prenom: string; email: string } | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  return (
    <Ctx.Provider
      value={{
        cart,
        setSelection: setCart,
        clearCart: () => setCart([]),
        user,
        signIn: (prenom, email) => setUser({ prenom, email }),
        signOut: () => setUser(null),
        toasts,
        toast,
        dismissToast,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useStore() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useStore must be used within StoreProvider");
  return c;
}
