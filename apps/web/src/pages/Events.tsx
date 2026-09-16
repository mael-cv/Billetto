import { useEffect, useMemo, useState } from "react";
import { fetchEvents, type EventFilters } from "../lib/api";
import { categories, cities, type BilettoEvent } from "../lib/data";
import { useRouter } from "../lib/router";
import { Button, EmptyState, ErrorState, Select } from "../components/ui";
import { EventCard, EventCardSkeleton } from "../components/EventCard";
import { IconClose, IconFilter, IconSearch } from "../components/icons";
import { Footer, Page } from "../components/Layout";

function useQueryParams() {
  const { path } = useRouter();
  return useMemo(() => {
    const qs = path.split("?")[1] ?? "";
    return new URLSearchParams(qs);
  }, [path]);
}

function FilterControls({
  filters,
  setFilters,
}: {
  filters: EventFilters;
  setFilters: (f: EventFilters) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-muted-foreground">Ville</label>
        <Select value={filters.ville ?? cities[0]} onChange={(e) => setFilters({ ...filters, ville: e.target.value })}>
          {cities.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
      </div>
      <div>
        <label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-muted-foreground">Catégorie</label>
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => {
            const active = (filters.categorie ?? "Tout") === c;
            return (
              <button
                key={c}
                onClick={() => setFilters({ ...filters, categorie: c })}
                className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                  active ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {c}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Prix maximum · {filters.prixMax ?? 250} €
        </label>
        <input
          type="range"
          min={10}
          max={250}
          step={5}
          value={filters.prixMax ?? 250}
          onChange={(e) => setFilters({ ...filters, prixMax: Number(e.target.value) })}
          className="w-full accent-[#d6ff3f]"
        />
      </div>
    </div>
  );
}

export function EventsPage() {
  const params = useQueryParams();
  const [filters, setFilters] = useState<EventFilters>({
    q: params.get("q") ?? "",
    ville: params.get("ville") ?? cities[0],
    categorie: params.get("categorie") ?? "Tout",
    tri: "date",
    prixMax: 250,
  });
  const [events, setEvents] = useState<BilettoEvent[]>([]);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [drawer, setDrawer] = useState(false);

  const load = () => {
    setStatus("loading");
    fetchEvents(filters)
      .then((e) => {
        setEvents(e);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [filters.ville, filters.categorie, filters.tri, filters.prixMax, filters.q]);

  return (
    <>
      <Page wide>
        <div className="pt-10">
          <h1 className="font-display text-4xl font-extrabold tracking-tight">Découvrir</h1>
          <p className="mt-2 text-muted-foreground">
            {status === "ready" ? `${events.length} événement${events.length > 1 ? "s" : ""}` : "Chargement…"}
          </p>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex flex-1 items-center gap-2 rounded-[12px] border border-border bg-card px-3">
            <IconSearch className="size-5 text-muted-foreground" />
            <input
              value={filters.q}
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
              placeholder="Rechercher un événement…"
              className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {filters.q && (
              <button onClick={() => setFilters({ ...filters, q: "" })} aria-label="Effacer">
                <IconClose className="size-4 text-muted-foreground hover:text-foreground" />
              </button>
            )}
          </div>
          <Select
            value={filters.tri}
            onChange={(e) => setFilters({ ...filters, tri: e.target.value as EventFilters["tri"] })}
            className="sm:w-48"
          >
            <option value="date">Trier : Date</option>
            <option value="prix">Trier : Prix croissant</option>
            <option value="tendance">Trier : Tendance</option>
          </Select>
          <Button variant="outline" onClick={() => setDrawer(true)} className="lg:hidden">
            <IconFilter className="size-4" /> Filtres
          </Button>
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-[260px_1fr]">
          <aside className="hidden lg:block">
            <div className="sticky top-24 rounded-[16px] border border-border bg-card p-5">
              <h2 className="mb-4 font-display font-semibold">Filtres</h2>
              <FilterControls filters={filters} setFilters={setFilters} />
            </div>
          </aside>

          <div>
            {status === "loading" && (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <EventCardSkeleton key={i} />
                ))}
              </div>
            )}
            {status === "error" && <ErrorState onRetry={load} />}
            {status === "ready" &&
              (events.length === 0 ? (
                <EmptyState
                  title="Aucun événement trouvé"
                  message="Essayez d'élargir vos filtres ou de changer de ville."
                  action={
                    <Button
                      variant="outline"
                      onClick={() => setFilters({ q: "", ville: cities[0], categorie: "Tout", tri: "date", prixMax: 250 })}
                    >
                      Réinitialiser les filtres
                    </Button>
                  }
                />
              ) : (
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                  {events.map((e, i) => (
                    <EventCard key={e.id} event={e} index={i} />
                  ))}
                </div>
              ))}
          </div>
        </div>
      </Page>

      {/* Mobile filter drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDrawer(false)} />
          <div className="absolute bottom-0 left-0 right-0 max-h-[85vh] overflow-y-auto rounded-t-[24px] border-t border-border bg-card p-6">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">Filtres</h2>
              <button onClick={() => setDrawer(false)} aria-label="Fermer" className="rounded-[10px] p-1.5 hover:bg-elevated">
                <IconClose />
              </button>
            </div>
            <FilterControls filters={filters} setFilters={setFilters} />
            <Button className="mt-6 w-full" onClick={() => setDrawer(false)}>
              Voir les résultats
            </Button>
          </div>
        </div>
      )}
      <Footer />
    </>
  );
}
