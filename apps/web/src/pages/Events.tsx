import { useEffect, useState } from "react";
import type { EventFilters, EventSort } from "../lib/api";
import { startOfToday, useDebounced, useQueryParams } from "../lib/hooks";
import { useCities, useEvents, useEventTypes } from "../lib/queries";
import { formatNumber } from "../lib/format";
import { Button, EmptyState, ErrorState, Pagination, Select } from "../components/ui";
import { EventCard, EventCardSkeleton } from "../components/EventCard";
import { IconClose, IconFilter, IconSearch } from "../components/icons";
import { Footer, Page } from "../components/Layout";

interface UiFilters {
  q: string;
  ville: string;
  typeId: string;
  prixMax: number;
  sort: EventSort;
  passes: boolean;
  page: number;
}

const PRIX_MAX = 250;
const SORTS: EventSort[] = ["date", "prix", "nom", "-date"];

function fromParams(params: URLSearchParams): UiFilters {
  const sort = params.get("sort") as EventSort | null;
  return {
    q: params.get("q") ?? "",
    ville: params.get("ville") ?? "",
    typeId: params.get("typeId") ?? "",
    prixMax: Number(params.get("prixMax")) || PRIX_MAX,
    sort: sort && SORTS.includes(sort) ? sort : "date",
    passes: params.get("passes") === "1",
    page: Math.max(1, Number(params.get("page")) || 1),
  };
}

function FilterControls({ filters, update }: { filters: UiFilters; update: (patch: Partial<UiFilters>) => void }) {
  const cities = useCities();
  const types = useEventTypes();
  return (
    <div className="flex flex-col gap-5">
      <div>
        <label htmlFor="filtre-ville" className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Ville
        </label>
        <Select id="filtre-ville" value={filters.ville} onChange={(e) => update({ ville: e.target.value })}>
          <option value="">Toutes les villes</option>
          {cities.data?.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
      </div>
      <div>
        <label htmlFor="filtre-type" className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Type (sous-types inclus)
        </label>
        <Select id="filtre-type" value={filters.typeId} onChange={(e) => update({ typeId: e.target.value })}>
          <option value="">Tous les types</option>
          {types.data?.map((t) => (
            <option key={t.id} value={t.id}>
              {"  ".repeat(t.niveau - 1)}
              {t.nom}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <label htmlFor="filtre-prix" className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Prix maximum · {filters.prixMax >= PRIX_MAX ? "sans limite" : `${filters.prixMax} €`}
        </label>
        <input
          id="filtre-prix"
          type="range"
          min={10}
          max={PRIX_MAX}
          step={5}
          value={filters.prixMax}
          onChange={(e) => update({ prixMax: Number(e.target.value) })}
          className="w-full accent-[#d6ff3f]"
        />
      </div>
      <label className="flex cursor-pointer items-center gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={filters.passes}
          onChange={(e) => update({ passes: e.target.checked })}
          className="size-4 accent-[#d6ff3f]"
        />
        Inclure les événements passés
      </label>
    </div>
  );
}

export function EventsPage() {
  const params = useQueryParams();
  const [filters, setFilters] = useState<UiFilters>(() => fromParams(params));
  const [drawer, setDrawer] = useState(false);
  const q = useDebounced(filters.q.trim());

  // Les filtres sont reflétés dans l'URL (lien partageable, retour arrière).
  useEffect(() => {
    const next = new URLSearchParams();
    if (filters.q) next.set("q", filters.q);
    if (filters.ville) next.set("ville", filters.ville);
    if (filters.typeId) next.set("typeId", filters.typeId);
    if (filters.prixMax < PRIX_MAX) next.set("prixMax", String(filters.prixMax));
    if (filters.sort !== "date") next.set("sort", filters.sort);
    if (filters.passes) next.set("passes", "1");
    if (filters.page > 1) next.set("page", String(filters.page));
    const target = "/events" + (next.toString() ? `?${next.toString()}` : "");
    if (window.location.hash.slice(1) !== target) window.history.replaceState(null, "", `#${target}`);
  }, [filters]);

  const update = (patch: Partial<UiFilters>) => setFilters((f) => ({ ...f, page: 1, ...patch }));

  const apiFilters: EventFilters = {
    q: q || undefined,
    ville: filters.ville || undefined,
    typeId: filters.typeId ? Number(filters.typeId) : undefined,
    prixMax: filters.prixMax < PRIX_MAX ? filters.prixMax : undefined,
    from: filters.passes ? undefined : startOfToday(),
    sort: filters.sort,
    page: filters.page,
    pageSize: 12,
  };
  const events = useEvents(apiFilters);
  const reset = () => setFilters(fromParams(new URLSearchParams()));

  return (
    <>
      <Page wide>
        <div className="pt-10">
          <h1 className="font-display text-4xl font-extrabold tracking-tight">Découvrir</h1>
          <p className="mt-2 text-muted-foreground" aria-live="polite">
            {events.data ? `${formatNumber(events.data.total)} événement${events.data.total > 1 ? "s" : ""}` : "Chargement…"}
          </p>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="flex flex-1 items-center gap-2 rounded-[12px] border border-border bg-card px-3">
            <IconSearch className="size-5 text-muted-foreground" />
            <span className="sr-only">Rechercher un événement</span>
            <input
              value={filters.q}
              onChange={(e) => update({ q: e.target.value })}
              maxLength={100}
              placeholder="Rechercher un événement, une ville, un type…"
              className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {filters.q && (
              <button onClick={() => update({ q: "" })} aria-label="Effacer la recherche">
                <IconClose className="size-4 text-muted-foreground hover:text-foreground" />
              </button>
            )}
          </label>
          <Select
            aria-label="Trier"
            value={filters.sort}
            onChange={(e) => update({ sort: e.target.value as EventSort })}
            className="sm:w-52"
          >
            <option value="date">Trier : date</option>
            <option value="prix">Trier : prix croissant</option>
            <option value="nom">Trier : nom</option>
            <option value="-date">Trier : plus récents</option>
          </Select>
          <Button variant="outline" onClick={() => setDrawer(true)} className="lg:hidden">
            <IconFilter className="size-4" /> Filtres
          </Button>
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-[260px_1fr]">
          <aside className="hidden lg:block">
            <div className="sticky top-24 rounded-[16px] border border-border bg-card p-5">
              <h2 className="mb-4 font-display font-semibold">Filtres</h2>
              <FilterControls filters={filters} update={update} />
            </div>
          </aside>

          <div>
            {events.isLoading && (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <EventCardSkeleton key={i} />
                ))}
              </div>
            )}
            {events.isError && <ErrorState onRetry={() => void events.refetch()} />}
            {events.data &&
              (events.data.items.length === 0 ? (
                <EmptyState
                  title="Aucun événement trouvé"
                  message="Essayez d'élargir vos filtres ou de changer de ville."
                  action={
                    <Button variant="outline" onClick={reset}>
                      Réinitialiser les filtres
                    </Button>
                  }
                />
              ) : (
                <>
                  <div className={`grid grid-cols-2 gap-4 md:grid-cols-3 ${events.isFetching ? "opacity-60" : ""}`} data-testid="events-grid">
                    {events.data.items.map((e) => (
                      <EventCard key={e.id} event={e} />
                    ))}
                  </div>
                  <Pagination
                    page={events.data.page}
                    totalPages={events.data.totalPages}
                    onChange={(page) => {
                      setFilters((f) => ({ ...f, page }));
                      window.scrollTo({ top: 0 });
                    }}
                  />
                </>
              ))}
          </div>
        </div>
      </Page>

      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Filtres">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDrawer(false)} />
          <div className="absolute bottom-0 left-0 right-0 max-h-[85vh] overflow-y-auto rounded-t-[24px] border-t border-border bg-card p-6">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">Filtres</h2>
              <button onClick={() => setDrawer(false)} aria-label="Fermer" className="rounded-[10px] p-1.5 hover:bg-elevated">
                <IconClose />
              </button>
            </div>
            <FilterControls filters={filters} update={update} />
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
