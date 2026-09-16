import { useEffect, useState } from "react";
import { fetchEvents } from "../lib/api";
import { categories, cities, type BilettoEvent } from "../lib/data";
import { useRouter } from "../lib/router";
import { Button, Link } from "../components/ui";
import { EventCard, EventCardSkeleton } from "../components/EventCard";
import { IconArrow, IconPin, IconSearch } from "../components/icons";
import { Footer, Page } from "../components/Layout";

function SearchHero() {
  const { navigate } = useRouter();
  const [q, setQ] = useState("");
  const [ville, setVille] = useState(cities[0]);

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
          <span className="size-1.5 rounded-full bg-primary" /> 5 001 événements en ligne
        </span>
        <h1 className="mt-6 max-w-3xl font-display text-5xl font-extrabold leading-[0.95] tracking-tight text-balance sm:text-7xl">
          Les événements qui comptent, au bon prix.
        </h1>
        <p className="mt-5 max-w-xl text-lg text-muted-foreground">
          Concerts, festivals, clubbing, sport. Trouvez votre prochaine sortie et réservez en quelques secondes.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const params = new URLSearchParams();
            if (q) params.set("q", q);
            if (ville !== cities[0]) params.set("ville", ville);
            navigate("/events" + (params.toString() ? "?" + params.toString() : ""));
          }}
          className="mt-8 flex w-full max-w-2xl flex-col gap-2 rounded-[16px] border border-border bg-card/90 p-2 backdrop-blur sm:flex-row"
        >
          <div className="flex flex-1 items-center gap-2 rounded-[12px] bg-background px-3">
            <IconSearch className="size-5 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Artiste, événement, lieu…"
              className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="flex items-center gap-2 rounded-[12px] bg-background px-3 sm:w-52">
            <IconPin className="size-5 text-muted-foreground" />
            <select
              value={ville}
              onChange={(e) => setVille(e.target.value)}
              className="h-11 w-full appearance-none bg-transparent text-sm outline-none"
            >
              {cities.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <Button type="submit" size="lg" className="sm:w-auto">
            Rechercher
          </Button>
        </form>

        <div className="mt-6 flex flex-wrap gap-2">
          {categories.slice(1).map((c) => (
            <Link
              key={c}
              to={`/events?categorie=${encodeURIComponent(c)}`}
              className="rounded-full border border-border bg-background/50 px-3.5 py-1.5 text-sm text-foreground/90 backdrop-blur transition-colors hover:border-primary/40 hover:text-primary"
            >
              {c}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function Row({ title, subtitle, items, loading }: { title: string; subtitle?: string; items: BilettoEvent[]; loading: boolean }) {
  return (
    <section className="mt-16">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        <Link to="/events" className="group hidden items-center gap-1.5 text-sm font-medium text-primary sm:flex">
          Tout voir
          <IconArrow className="size-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => <EventCardSkeleton key={i} />)
          : items.map((e, i) => <EventCard key={e.id} event={e} index={i} />)}
      </div>
    </section>
  );
}

function FeaturedBanner({ event }: { event: BilettoEvent }) {
  return (
    <Link
      to={`/events/${event.slug}`}
      className="group relative mt-16 block overflow-hidden rounded-[24px] border border-border"
    >
      <div className="aspect-[16/7] w-full bg-elevated">
        <img src={event.image} alt={event.nom} className="size-full object-cover transition-transform duration-700 group-hover:scale-[1.03]" />
      </div>
      <div className="absolute inset-0 bg-gradient-to-r from-background via-background/70 to-transparent" />
      <div className="absolute inset-0 flex flex-col justify-center gap-4 p-8 sm:p-14">
        <span className="w-fit rounded-full bg-primary px-3 py-1 font-mono text-xs font-semibold uppercase tracking-wide text-primary-foreground">
          À la une
        </span>
        <h3 className="max-w-lg font-display text-3xl font-extrabold leading-tight text-balance sm:text-5xl">{event.nom}</h3>
        <p className="max-w-md text-muted-foreground">{event.description}</p>
        <Button className="w-fit" size="lg">
          Réserver <IconArrow className="size-4" />
        </Button>
      </div>
    </Link>
  );
}

export function HomePage() {
  const [events, setEvents] = useState<BilettoEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchEvents().then((e) => {
      setEvents(e);
      setLoading(false);
    });
  }, []);

  const featured = events.find((e) => e.featured);
  const weekend = events.filter((e) => e.statut === "published").slice(0, 4);
  const trending = events.filter((e) => e.tendance).slice(0, 4);

  return (
    <>
      <SearchHero />
      <Page wide>
        <Row title="Cette semaine" subtitle="Les prochaines sorties près de chez vous" items={weekend} loading={loading} />
        {featured && <FeaturedBanner event={featured} />}
        <Row title="Tendances" subtitle="Ce qui fait vibrer la communauté" items={trending} loading={loading} />

        <section className="mt-20 grid gap-4 rounded-[24px] border border-border bg-card p-8 sm:grid-cols-3 sm:p-12">
          {[
            ["Paiement sécurisé", "Vos transactions sont chiffrées de bout en bout."],
            ["Billets mobiles", "QR code instantané, ajout au wallet en un geste."],
            ["Remboursement simple", "Annulation d'événement remboursée automatiquement."],
          ].map(([t, d]) => (
            <div key={t}>
              <h4 className="font-display text-lg font-semibold">{t}</h4>
              <p className="mt-1.5 text-sm text-muted-foreground">{d}</p>
            </div>
          ))}
        </section>
      </Page>
      <Footer />
    </>
  );
}
