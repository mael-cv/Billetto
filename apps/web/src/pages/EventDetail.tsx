import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { startOfToday, useQueryParams } from "../lib/hooks";
import { ApiError } from "../lib/http";
import { formatDate, formatEUR, formatTime } from "../lib/format";
import {
  attributeLabel,
  attributeValue,
  AVAILABILITY_LABEL,
  eventImage,
  STATUS_LABEL,
  tierAvailability,
} from "../lib/presentation";
import { keys, useEvents } from "../lib/queries";
import { useRouter } from "../lib/router";
import { useStore } from "../lib/store";
import type { EventDetail, Scope, TicketPrice } from "../lib/types";
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Link, Skeleton } from "../components/ui";
import { QuantitySelector } from "../components/QuantitySelector";
import { EventCard } from "../components/EventCard";
import { IconArrow, IconCalendar, IconClock, IconPin, IconShield, IconUser } from "../components/icons";
import { Footer, Page } from "../components/Layout";

const MAX_PAR_COMMANDE = 10;

function PriceCard({
  tier,
  event,
  qty,
  onQty,
}: {
  tier: TicketPrice;
  event: EventDetail;
  qty: number;
  onQty: (v: number) => void;
}) {
  const availability = tierAvailability(tier, event);
  const buyable = availability === "disponible";
  return (
    <div
      data-testid={`tarif-${tier.id}`}
      className={`flex items-center justify-between gap-3 rounded-[12px] border p-3.5 transition-colors ${
        qty > 0 ? "border-primary/50 bg-primary/5" : "border-border"
      } ${!buyable ? "opacity-60" : ""}`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{tier.nom}</span>
          {!buyable && <Badge tone="muted">{AVAILABILITY_LABEL[availability]}</Badge>}
          {buyable && tier.restantes < 20 && <Badge tone="warning">Plus que {tier.restantes}</Badge>}
        </div>
        {buyable && tier.restantes >= 20 && (
          <p className="mt-0.5 text-sm text-muted-foreground">{tier.restantes} places restantes</p>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className="font-display font-bold tabular-nums">{formatEUR(tier.prix)}</span>
        <QuantitySelector
          value={qty}
          onChange={onQty}
          disabled={!buyable}
          max={Math.min(MAX_PAR_COMMANDE, Math.max(tier.restantes, 0))}
        />
      </div>
    </div>
  );
}

export function EventDetailPage({ slug }: { slug: string }) {
  const { navigate } = useRouter();
  const { setCart, toast } = useStore();
  const { user } = useAuth();
  const params = useQueryParams();
  // « gestion » : un organisateur consulte son brouillon avec ses propres droits.
  const scope: Scope = params.get("scope") === "manage" ? "manage" : "public";
  const query = useQuery({ queryKey: keys.event(slug, scope), queryFn: () => api.event(slug, scope) });
  const event = query.data;
  const related = useEvents({ typeId: event?.type.id, from: startOfToday(), pageSize: 5, sort: "date" });

  // Une commande porte sur un seul tarif : choisir une quantité sur un tarif réinitialise les autres.
  const [selection, setSelection] = useState<{ tarifId: number; quantite: number } | null>(null);
  const selectedTier = event?.tarifs.find((t) => t.id === selection?.tarifId);
  const total = selectedTier && selection ? Number(selectedTier.prix) * selection.quantite : 0;
  const prixMin = event?.tarifs.filter((t) => t.actif).reduce<number | null>((m, t) => (m === null ? Number(t.prix) : Math.min(m, Number(t.prix))), null);

  const goCheckout = () => {
    if (!event || !selectedTier || !selection) return toast("Sélectionnez au moins un billet", "error");
    setCart({
      eventId: event.id,
      eventSlug: event.slug,
      eventNom: event.nom,
      eventDebut: event.debut,
      eventImage: eventImage(event, 200, 200),
      lieu: `${event.lieu.nom}, ${event.lieu.ville}`,
      tarifId: selectedTier.id,
      tarifNom: selectedTier.nom,
      prix: selectedTier.prix,
      quantite: selection.quantite,
      restantes: selectedTier.restantes,
    });
    navigate("/checkout");
  };

  if (query.isLoading)
    return (
      <Page wide>
        <div className="pt-8" aria-busy="true">
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

  if (query.isError || !event) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <>
        <Page>
          <div className="pt-16">
            {notFound ? (
              <EmptyState
                title="Événement introuvable"
                message="Cet événement n'existe pas ou n'est pas (encore) publié."
                action={<Button onClick={() => navigate("/events")}>Voir les événements</Button>}
              />
            ) : (
              <ErrorState onRetry={() => void query.refetch()} />
            )}
          </div>
        </Page>
        <Footer />
      </>
    );
  }

  const count = selection?.quantite ?? 0;
  const anyBuyable = event.tarifs.some((t) => tierAvailability(t, event) === "disponible");
  const isOwner = user && (user.role === "admin" || user.organisateurId === event.organisateurId);

  const purchasePanel = (
    <Card className="p-5">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-muted-foreground">À partir de</span>
        <span className="font-display text-2xl font-bold">{prixMin === null || prixMin === undefined ? "—" : formatEUR(prixMin)}</span>
      </div>
      {event.tarifs.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Aucun tarif en vente pour le moment.</p>
      ) : (
        <div className="mt-4 space-y-2.5">
          {event.tarifs.map((t) => (
            <PriceCard
              key={t.id}
              tier={t}
              event={event}
              qty={selection?.tarifId === t.id ? selection.quantite : 0}
              onQty={(v) => setSelection(v > 0 ? { tarifId: t.id, quantite: v } : null)}
            />
          ))}
        </div>
      )}
      {!anyBuyable && event.tarifs.length > 0 && (
        <div className="mt-4">
          <Alert tone="info">Aucun billet n'est actuellement en vente pour cet événement.</Alert>
        </div>
      )}
      {count > 0 && selectedTier && (
        <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
          <span className="text-sm text-muted-foreground">
            {count} billet{count > 1 ? "s" : ""} · {selectedTier.nom}
          </span>
          <span className="font-display text-xl font-bold">{formatEUR(total)}</span>
        </div>
      )}
      <Button className="mt-4 w-full" size="lg" onClick={goCheckout} disabled={count === 0}>
        {count === 0 ? "Choisissez vos billets" : "Continuer"}
        {count > 0 && <IconArrow className="size-4" />}
      </Button>
      <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <IconShield className="size-3.5" /> Places garanties à la validation · 1 tarif par commande
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
          {event.statut !== "published" && (
            <div className="mb-4">
              <Alert tone="info">
                Statut : <strong>{STATUS_LABEL[event.statut]}</strong>
                {event.statut === "draft" && " — visible uniquement par son organisateur et les administrateurs."}
              </Alert>
            </div>
          )}
          <div className="relative overflow-hidden rounded-[24px] border border-border">
            <div className="aspect-[16/8] w-full bg-elevated sm:aspect-[16/6]">
              <img src={eventImage(event, 1600, 700)} alt="" className="size-full object-cover" />
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-background/90 to-transparent" />
            <div className="absolute bottom-0 left-0 p-6 sm:p-10">
              <Badge tone="accent">{event.type.nom}</Badge>
              <h1 className="mt-3 max-w-3xl font-display text-3xl font-extrabold leading-tight text-balance sm:text-5xl">{event.nom}</h1>
            </div>
          </div>
          {isOwner && (
            <div className="mt-4">
              <Button variant="outline" size="sm" onClick={() => navigate("/organizer/events")}>
                Gérer mes événements
              </Button>
            </div>
          )}
        </div>

        <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_380px]">
          <div>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                [<IconCalendar key="c" className="size-5" />, "Date", formatDate(event.debut)],
                [<IconClock key="t" className="size-5" />, "Horaires", `${formatTime(event.debut)} – ${formatTime(event.fin)}`],
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

            {event.description && (
              <section className="mt-10">
                <h2 className="font-display text-xl font-bold">À propos</h2>
                <p className="mt-3 whitespace-pre-line leading-relaxed text-foreground/90">{event.description}</p>
              </section>
            )}

            {event.attributs.length > 0 && (
              <section className="mt-10">
                <h2 className="font-display text-xl font-bold">Informations pratiques</h2>
                <dl className="mt-4 grid gap-2 sm:grid-cols-2">
                  {event.attributs.map((a) => (
                    <div key={a.cle} className="flex items-center justify-between rounded-[10px] border border-border bg-card px-4 py-3">
                      <dt className="text-sm text-muted-foreground">{attributeLabel(a.cle)}</dt>
                      <dd className="text-sm font-medium">{attributeValue(a.cle, a.valeur)}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            <section className="mt-10">
              <h2 className="font-display text-xl font-bold">Organisateur</h2>
              <div className="mt-4 flex items-center gap-3 rounded-[12px] border border-border bg-card p-4">
                <span className="flex size-11 items-center justify-center rounded-full bg-primary/15 text-primary">
                  <IconUser />
                </span>
                <span className="font-medium">{event.organisateur}</span>
              </div>
            </section>

            <section className="mt-10">
              <h2 className="font-display text-xl font-bold">Lieu</h2>
              <div className="mt-4 overflow-hidden rounded-[16px] border border-border">
                <div className="flex h-52 items-center justify-center bg-[radial-gradient(circle_at_30%_40%,rgba(214,255,63,0.08),transparent_50%),radial-gradient(circle_at_70%_70%,rgba(214,255,63,0.05),transparent_40%)] bg-elevated">
                  <div className="text-center">
                    <IconPin className="mx-auto size-7 text-primary" />
                    <p className="mt-2 font-medium">{event.lieu.nom}</p>
                    <p className="text-sm text-muted-foreground">
                      {event.lieu.adresse}, {event.lieu.codePostal} {event.lieu.ville}
                    </p>
                    <p className="text-xs text-muted-foreground">Capacité {event.lieu.capacite.toLocaleString("fr-FR")} personnes</p>
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

        {related.data && related.data.items.filter((e) => e.id !== event.id).length > 0 && (
          <section className="mt-16">
            <h2 className="mb-5 font-display text-2xl font-bold">Dans la même catégorie</h2>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {related.data.items
                .filter((e) => e.id !== event.id)
                .slice(0, 4)
                .map((e) => (
                  <EventCard key={e.id} event={e} />
                ))}
            </div>
          </section>
        )}
      </Page>

      <div className="sticky bottom-0 z-30 border-t border-border bg-background/95 p-3 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-3">
          <div>
            <div className="text-xs text-muted-foreground">{count > 0 ? `${count} billet(s)` : "À partir de"}</div>
            <div className="font-display text-lg font-bold">{count > 0 ? formatEUR(total) : prixMin ? formatEUR(prixMin) : "—"}</div>
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
