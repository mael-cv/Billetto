import { useState } from "react";
import { useCities, useEvents, useRootTypes } from "../lib/queries";
import { startOfToday } from "../lib/hooks";
import { formatDate, formatNumber } from "../lib/format";
import { eventImage } from "../lib/presentation";
import type { EventSummary } from "../lib/types";
import { useRouter } from "../lib/router";
import { Button, ErrorState, Link } from "../components/ui";
import { EventCard, EventCardSkeleton } from "../components/EventCard";
import { IconArrow, IconPin, IconSearch } from "../components/icons";
import { Footer, Page } from "../components/Layout";

const TODAY = startOfToday();

function SearchHero({ total }: { total: number | undefined }) {
  const { navigate } = useRouter();
  const cities = useCities();
  const rootTypes = useRootTypes();
  const [q, setQ] = useState("");
  const [ville, setVille] = useState("");

  return (
    <section className="relative overflow-hidden border-b border-border">
      <div className="absolute inset-0">
        <img
          src="https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=1800&h=1000&fit=crop&auto=format"
          alt=""
          className="size-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/70 via-background/85 to-background" />
      </div>
      <div className="relative mx-auto max-w-[1240px] px-5 pb-16 pt-20 sm:pt-28">
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background/60 px-3 py-1 font-mono text-xs uppercase tracking-widest text-primary backdrop-blur">
          <span className="size-1.5 rounded-full bg-primary" />
          {total === undefined ? "Chargement…" : `${formatNumber(total)} événements à venir`}
        </span>
        <h1 className="mt-6 max-w-3xl font-display text-5xl font-extrabold leading-[0.95] tracking-tight text-balance sm:text-7xl">
          Les événements qui comptent, au bon prix.
        </h1>
        <p className="mt-5 max-w-xl text-lg text-muted-foreground">
          Concerts, festivals, sport, spectacles. Trouvez votre prochaine sortie et réservez en quelques secondes.
        </p>

        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            const params = new URLSearchParams();
            if (q.trim()) params.set("q", q.trim());
            if (ville) params.set("ville", ville);
            navigate("/events" + (params.toString() ? "?" + params.toString() : ""));
          }}
          className="mt-8 flex w-full max-w-2xl flex-col gap-2 rounded-[16px] border border-border bg-card/90 p-2 backdrop-blur sm:flex-row"
        >
          <label className="flex flex-1 items-center gap-2 rounded-[12px] bg-background px-3">
            <IconSearch className="size-5 text-muted-foreground" />
            <span className="sr-only">Rechercher</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              maxLength={100}
              placeholder="Événement, ville, type…"
              className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </label>
          <label className="flex items-center gap-2 rounded-[12px] bg-background px-3 sm:w-52">
            <IconPin className="size-5 text-muted-foreground" />
            <span className="sr-only">Ville</span>
            <select
              value={ville}
              onChange={(e) => setVille(e.target.value)}
              className="h-11 w-full appearance-none bg-transparent text-sm outline-none"
            >
              <option value="">Toutes les villes</option>
              {cities.data?.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <Button type="submit" size="lg" className="sm:w-auto">
            Rechercher
          </Button>
        </form>

        <div className="mt-6 flex flex-wrap gap-2">
          {rootTypes.data?.map((t) => (
            <Link
              key={t.id}
              to={`/events?typeId=${t.id}`}
              className="rounded-full border border-border bg-background/50 px-3.5 py-1.5 text-sm text-foreground/90 backdrop-blur transition-colors hover:border-primary/40 hover:text-primary"
            >
              {t.nom}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function Row({
  title,
  subtitle,
  to,
  items,
  loading,
  error,
  onRetry,
}: {
  title: string;
  subtitle: string;
  to: string;
  items: EventSummary[] | undefined;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  return (
    <section className="mt-16">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <Link to={to} className="group hidden items-center gap-1.5 text-sm font-medium text-primary sm:flex">
          Tout voir
          <IconArrow className="size-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
      {error ? (
        <ErrorState onRetry={onRetry} />
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {loading
            ? Array.from({ length: 4 }).map((_, i) => <EventCardSkeleton key={i} />)
            : items?.map((e) => <EventCard key={e.id} event={e} />)}
        </div>
      )}
    </section>
  );
}

function FeaturedBanner({ event }: { event: EventSummary }) {
  return (
    <Link to={`/events/${event.slug}`} className="group relative mt-16 block overflow-hidden rounded-[24px] border border-border">
      <div className="aspect-[16/7] w-full bg-elevated">
        <img src={eventImage(event, 1600, 700)} alt="" className="size-full object-cover transition-transform duration-700 group-hover:scale-[1.03]" />
      </div>
      <div className="absolute inset-0 bg-gradient-to-r from-background via-background/70 to-transparent" />
      <div className="absolute inset-0 flex flex-col justify-center gap-4 p-8 sm:p-14">
        <span className="w-fit rounded-full bg-primary px-3 py-1 font-mono text-xs font-semibold uppercase tracking-wide text-primary-foreground">
          À la une
        </span>
        <h3 className="max-w-lg font-display text-3xl font-extrabold leading-tight text-balance sm:text-5xl">{event.nom}</h3>
        <p className="max-w-md text-muted-foreground">
          {formatDate(event.debut)} · {event.lieu.nom}, {event.lieu.ville}
        </p>
        <span className="inline-flex h-13 w-fit items-center gap-2 rounded-[14px] bg-primary px-7 text-base font-medium text-primary-foreground">
          Réserver <IconArrow className="size-4" />
        </span>
      </div>
    </Link>
  );
}

export function HomePage() {
  const upcoming = useEvents({ from: TODAY, sort: "date", pageSize: 5 });
  const cheap = useEvents({ from: TODAY, sort: "prix", pageSize: 4 });
  const featured = upcoming.data?.items[4] ?? upcoming.data?.items[0];

  return (
    <>
      <SearchHero total={upcoming.data?.total} />
      <Page wide>
        <Row
          title="Prochainement"
          subtitle="Les prochaines dates en vente"
          to="/events"
          items={upcoming.data?.items.slice(0, 4)}
          loading={upcoming.isLoading}
          error={upcoming.isError}
          onRetry={() => void upcoming.refetch()}
        />
        {featured && <FeaturedBanner event={featured} />}
        <Row
          title="Petits prix"
          subtitle="Les sorties les plus accessibles"
          to="/events?sort=prix"
          items={cheap.data?.items}
          loading={cheap.isLoading}
          error={cheap.isError}
          onRetry={() => void cheap.refetch()}
        />

        <section className="mt-20 grid gap-4 rounded-[24px] border border-border bg-card p-8 sm:grid-cols-3 sm:p-12">
          {[
            ["Jamais de survente", "Chaque place est réservée de façon atomique par la base de données."],
            ["Billets instantanés", "Vos billets et leur code unique sont disponibles dès le paiement."],
            ["Remboursement simple", "Remboursez votre commande en un clic jusqu'au début de l'événement."],
          ].map(([t, d]) => (
            <div key={t}>
              <h2 className="font-display text-lg font-semibold">{t}</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">{d}</p>
            </div>
          ))}
        </section>
      </Page>
      <Footer />
    </>
  );
}
