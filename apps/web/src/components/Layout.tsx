import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "../lib/router";
import { useStore } from "../lib/store";
import { Button, Link } from "./ui";
import { IconClose, IconMenu, IconSearch, IconTicket, IconUser } from "./icons";

const nav = [
  { to: "/events", label: "Découvrir" },
  { to: "/organizer", label: "Organisateurs" },
  { to: "/admin", label: "Admin" },
];

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2">
      <span className="flex size-8 items-center justify-center rounded-[9px] bg-primary text-primary-foreground">
        <IconTicket className="size-5" />
      </span>
      <span className="font-display text-xl font-extrabold tracking-tight">Billetto</span>
    </Link>
  );
}

export function Header() {
  const { path, navigate } = useRouter();
  const { user, cart } = useStore();
  const [open, setOpen] = useState(false);
  const cartCount = cart.reduce((n, i) => n + i.quantite, 0);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-6 px-5">
        <Logo />
        <nav className="hidden items-center gap-1 md:flex">
          {nav.map((n) => {
            const active = path.startsWith(n.to);
            return (
              <Link
                key={n.to}
                to={n.to}
                className={`rounded-[10px] px-3 py-2 text-sm font-medium transition-colors ${
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => navigate("/events")}
            aria-label="Rechercher"
            className="hidden size-10 items-center justify-center rounded-[11px] text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground sm:flex"
          >
            <IconSearch />
          </button>
          <Link
            to="/tickets"
            className="relative hidden size-10 items-center justify-center rounded-[11px] text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground sm:flex"
          >
            <IconTicket />
            {cartCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                {cartCount}
              </span>
            )}
          </Link>
          {user ? (
            <Link to="/account" className="hidden sm:block">
              <div className="flex items-center gap-2 rounded-full border border-border py-1 pl-1 pr-3 transition-colors hover:bg-elevated">
                <span className="flex size-8 items-center justify-center rounded-full bg-primary/15 text-primary">
                  <IconUser className="size-4" />
                </span>
                <span className="text-sm font-medium">{user.prenom}</span>
              </div>
            </Link>
          ) : (
            <div className="hidden items-center gap-2 sm:flex">
              <Button variant="ghost" size="sm" onClick={() => navigate("/login")}>
                Connexion
              </Button>
              <Button size="sm" onClick={() => navigate("/register")}>
                Créer un compte
              </Button>
            </div>
          )}
          <button
            aria-label="Menu"
            onClick={() => setOpen((o) => !o)}
            className="flex size-10 items-center justify-center rounded-[11px] text-foreground hover:bg-elevated md:hidden"
          >
            {open ? <IconClose /> : <IconMenu />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-border bg-background px-5 py-4 md:hidden">
          <nav className="flex flex-col gap-1">
            {nav.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                onClick={() => setOpen(false)}
                className="rounded-[10px] px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-elevated hover:text-foreground"
              >
                {n.label}
              </Link>
            ))}
            <Link
              to="/tickets"
              onClick={() => setOpen(false)}
              className="rounded-[10px] px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-elevated hover:text-foreground"
            >
              Mes billets
            </Link>
          </nav>
          <div className="mt-3 flex gap-2">
            {user ? (
              <Button variant="outline" size="sm" className="flex-1" onClick={() => { setOpen(false); navigate("/account"); }}>
                Mon compte
              </Button>
            ) : (
              <>
                <Button variant="outline" size="sm" className="flex-1" onClick={() => { setOpen(false); navigate("/login"); }}>
                  Connexion
                </Button>
                <Button size="sm" className="flex-1" onClick={() => { setOpen(false); navigate("/register"); }}>
                  Créer un compte
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}

export function Footer() {
  const groups = [
    { title: "Découvrir", links: [["Tous les événements", "/events"], ["Concerts", "/events"], ["Festivals", "/events"], ["Clubbing", "/events"]] },
    { title: "Organisateurs", links: [["Dashboard", "/organizer"], ["Créer un événement", "/organizer/events/new"], ["Mes événements", "/organizer/events"], ["Ventes", "/organizer/sales"]] },
    { title: "Compte", links: [["Connexion", "/login"], ["Créer un compte", "/register"], ["Mes billets", "/tickets"], ["Mon compte", "/account"]] },
  ];
  return (
    <footer className="mt-24 border-t border-border">
      <div className="mx-auto max-w-[1240px] px-5 py-14">
        <div className="grid gap-10 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-sm text-muted-foreground">
              La billetterie des événements qui comptent. Découvrez, réservez, vivez.
            </p>
          </div>
          {groups.map((g) => (
            <div key={g.title}>
              <h4 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">{g.title}</h4>
              <ul className="mt-4 space-y-2.5">
                {g.links.map(([label, to]) => (
                  <li key={label}>
                    <Link to={to} className="text-sm text-foreground/80 transition-colors hover:text-primary">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-border pt-6 text-sm text-muted-foreground sm:flex-row sm:items-center">
          <span>© 2026 Billetto — Tous droits réservés.</span>
          <div className="flex gap-5">
            <a href="#/" className="hover:text-foreground">Mentions légales</a>
            <a href="#/" className="hover:text-foreground">Confidentialité</a>
            <a href="#/" className="hover:text-foreground">CGV</a>
          </div>
        </div>
      </div>
    </footer>
  );
}

export function Toaster() {
  const { toasts, dismissToast } = useStore();
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex w-[calc(100vw-2.5rem)] max-w-sm flex-col gap-2">
      {toasts.map((t) => {
        const tones = {
          success: "border-success/30 bg-success/10 text-success",
          error: "border-danger/30 bg-danger/10 text-danger",
          info: "border-border bg-elevated text-foreground",
        } as const;
        return (
          <div
            key={t.id}
            role="status"
            onClick={() => dismissToast(t.id)}
            className={`animate-fade-up pointer-events-auto flex items-center gap-3 rounded-[12px] border px-4 py-3 text-sm shadow-lg backdrop-blur ${tones[t.tone]}`}
          >
            <span className="font-medium">{t.message}</span>
          </div>
        );
      })}
    </div>
  );
}

// Scrolls to top when the route changes and provides consistent page padding.
export function Page({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const { path } = useRouter();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);
  return <main className={`mx-auto w-full px-5 ${wide ? "max-w-[1240px]" : "max-w-[1080px]"}`}>{children}</main>;
}
