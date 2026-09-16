import { useEffect, useMemo, useState } from "react";
import { fetchEvent, fetchEvents } from "../lib/api";
import { formatDate, formatEUR, type BilettoEvent } from "../lib/data";
import { useRouter } from "../lib/router";
import { useStore, type CartItem } from "../lib/store";
import { Badge, Button, Card, ErrorState, Link, Skeleton } from "../components/ui";
import { QuantitySelector } from "../components/QuantitySelector";
import { EventCard } from "../components/EventCard";
import { IconArrow, IconCalendar, IconClock, IconPin, IconShield, IconUser } from "../components/icons";
import { Footer, Page } from "../components/Layout";

function PriceCard({
  tier,
  qty,
  onQty,
}: {
  tier: BilettoEvent["tarifs"][number];
  qty: number;
  onQty: (v: number) => void;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-[12px] border p-3.5 transition-colors ${
        qty > 0 ? "border-primary/50 bg-primary/5" : "border-border"
      } ${!tier.disponible ? "opacity-60" : ""}`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium">{tier.nom}</span>
          {!tier.disponible && <Badge tone="muted">Épuisé</Badge>}
          {tier.disponible && tier.restants !== undefined && tier.restants < 20 && (
            <Badge tone="warning">Derniers billets</Badge>
          )}
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">{tier.description}</p>
      </div>
      <div className="flex items-center gap-3">
        <span className="font-display font-bold tabular-nums">{formatEUR(tier.prix)}</span>
        <QuantitySelector value={qty} onChange={onQty} disabled={!tier.disponible} max={8} />
      </div>
    </div>
  );
}

export function EventDetailPage({ slug }: { slug: string }) {
  const { navigate } = useRouter();
  const { setSelection, toast } = useStore();
  const [event, setEvent] = useState<BilettoEvent | null>(null);
  const [related, setRelated] = useState<BilettoEvent[]>([]);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [qty, setQty] = useState<Record<string, number>>({});

  const load = () => {
    setStatus("loading");
    fetchEvent(slug)
      .then((e) => {
        if (!e) return setStatus("error");
        setEvent(e);
        setStatus("ready");
        fetchEvents({ categorie: e.categorie }).then((all) => setRelated(all.filter((x) => x.slug !== slug).slice(0, 4)));
      })
      .catch(() => setStatus("error"));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [slug]);

  const { total, count, items } = useMemo(() => {
    if (!event) return { total: 0, count: 0, items: [] as CartItem[] };
    const its: CartItem[] = [];
    let t = 0;
    let c = 0;
    for (const tier of event.tarifs) {
      const q = qty[tier.id] ?? 0;
      if (q > 0) {
        t += q * tier.prix;
        c += q;
        its.push({
          eventSlug: event.slug,
          eventNom: event.nom,
          eventImage: event.image,
          tarifId: tier.id,
          tarifNom: tier.nom,
          prix: tier.prix,
          quantite: q,
        });
      }
    }
    return { total: t, count: c, items: its };
  }, [qty, event]);

  const goCheckout = () => {
    if (count === 0) return toast("Sélectionnez au moins un billet", "error");
    setSelection(items);
    navigate("/checkout");
  };

  if (status === "loading")
    return (
      <Page wide>
        <div className="pt-8">
          <Skeleton className="aspect-[16/7] w-full rounded-[24px]" />
          <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_380px]">
            <div className="space-y-4">
              <Skeleton className="h-10 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-40 w-full" />
            </div>
            <Skeleton className="h-80 w-full rounded-[16px]" />
          </div>
        </div>
      </Page>
    );

  if (status === "error" || !event)
    return (
      <Page>
        <div className="pt-16">
          <ErrorState onRetry={load} />
        </div>
      </Page>
    );

  const purchasePanel = (
    <Card className="p-5">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-muted-foreground">À partir de</span>
        <span className="font-display text-2xl font-bold">{formatEUR(event.aPartirDe)}</span>
      </div>
      <div className="mt-4 space-y-2.5">
        {event.tarifs.map((t) => (
          <PriceCard key={t.id} tier={t} qty={qty[t.id] ?? 0} onQty={(v) => setQty((q) => ({ ...q, [t.id]: v }))} />
        ))}
      </div>
      {count > 0 && (
        <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
          <span className="text-sm text-muted-foreground">
            {count} billet{count > 1 ? "s" : ""}
          </span>
          <span className="font-display text-xl font-bold">{formatEUR(total)}</span>
        </div>
      )}
      <Button className="mt-4 w-full" size="lg" onClick={goCheckout} disabled={count === 0}>
        {count === 0 ? "Choisissez vos billets" : "Continuer"}
        {count > 0 && <IconArrow className="size-4" />}
      </Button>
      <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <IconShield className="size-3.5" /> Paiement sécurisé · Billets instantanés
      </p>
    </Card>
  );

  return (
    <>
      <Page wide>
        <div className="pt-6">
          <Link to="/events" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <IconArrow className="size-4 rotate-180" /> Retour aux événements
          </Link>
          <div className="relative overflow-hidden rounded-[24px] border border-border">
            <div className="aspect-[16/8] w-full bg-elevated sm:aspect-[16/6]">
              <img src={event.image} alt={event.nom} className="size-full object-cover" />
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-background/90 to-transparent" />
            <div className="absolute bottom-0 left-0 p-6 sm:p-10">
              <div className="flex flex-wrap gap-2">
                <Badge tone="accent">{event.categorie}</Badge>
                <Badge tone="muted">{event.type}</Badge>
              </div>
              <h1 className="mt-3 max-w-3xl font-display text-3xl font-extrabold leading-tight text-balance sm:text-5xl">
                {event.nom}
              </h1>
            </div>
          </div>
        </div>

        <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_380px]">
          <div>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                [<IconCalendar key="c" className="size-5" />, "Date", formatDate(event.date)],
                [<IconClock key="t" className="size-5" />, "Heure", event.heure],
                [<IconPin key="p" className="size-5" />, "Lieu", `${event.lieu.nom}, ${event.lieu.ville}`],
              ].map(([icon, label, value], i) => (
                <div key={i} className="flex items-center gap-3 rounded-[12px] border border-border bg-card p-3.5">
                  <span className="text-primary">{icon}</span>
                  <div className="min-w-0">
                    <div className="font-mono text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
                    <div className="truncate text-sm font-medium">{value}</div>
                  </div>
                </div>
              ))}
            </div>

            <section className="mt-10">
              <h2 className="font-display text-xl font-bold">À propos</h2>
              <p className="mt-3 leading-relaxed text-foreground/90">{event.description}</p>
            </section>

            <section className="mt-10">
              <h2 className="font-display text-xl font-bold">Informations pratiques</h2>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {event.attributs.map((a) => (
                  <div key={a.cle} className="flex items-center justify-between rounded-[10px] border border-border bg-card px-4 py-3">
                    <span className="text-sm text-muted-foreground">{a.cle}</span>
                    <span className="text-sm font-medium">{a.valeur}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="mt-10">
              <h2 className="font-display text-xl font-bold">Organisateur</h2>
              <div className="mt-4 flex items-center gap-3 rounded-[12px] border border-border bg-card p-4">
                <span className="flex size-11 items-center justify-center rounded-full bg-primary/15 text-primary">
                  <IconUser />
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{event.organisateur.nom}</span>
                    {event.organisateur.verifie && <Badge tone="accent">Vérifié</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">{event.organisateur.evenements} événements organisés</p>
                </div>
              </div>
            </section>

            <section className="mt-10">
              <h2 className="font-display text-xl font-bold">Lieu</h2>
              <div className="mt-4 overflow-hidden rounded-[16px] border border-border">
                <div className="flex h-52 items-center justify-center bg-[radial-gradient(circle_at_30%_40%,rgba(214,255,63,0.08),transparent_50%),radial-gradient(circle_at_70%_70%,rgba(214,255,63,0.05),transparent_40%)] bg-elevated">
                  <div className="text-center">
                    <IconPin className="mx-auto size-7 text-primary" />
                    <p className="mt-2 font-medium">{event.lieu.nom}</p>
                    <p className="text-sm text-muted-foreground">{event.lieu.adresse}</p>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <aside className="hidden lg:block">
            <div className="sticky top-24">{purchasePanel}</div>
          </aside>

          <div className="lg:hidden">{purchasePanel}</div>
        </div>

        {related.length > 0 && (
          <section className="mt-16">
            <h2 className="mb-5 font-display text-2xl font-bold">Événements similaires</h2>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {related.map((e, i) => (
                <EventCard key={e.id} event={e} index={i} />
              ))}
            </div>
          </section>
        )}
      </Page>

      {/* Mobile sticky CTA */}
      <div className="sticky bottom-0 z-30 border-t border-border bg-background/95 p-3 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-3">
          <div>
            <div className="text-xs text-muted-foreground">{count > 0 ? `${count} billet(s)` : "À partir de"}</div>
            <div className="font-display text-lg font-bold">{formatEUR(count > 0 ? total : event.aPartirDe)}</div>
          </div>
          <Button size="lg" onClick={goCheckout} disabled={count === 0} className="flex-1 max-w-xs">
            {count === 0 ? "Choisir des billets" : "Continuer"}
          </Button>
        </div>
      </div>
      <Footer />
    </>
  );
}
