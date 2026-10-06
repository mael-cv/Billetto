import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { formatDateTime, formatNumber, formatPercent } from "../lib/format";
import { freshness, LIVE_REFRESH_MS, liveSegments } from "../lib/live";
import { keys } from "../lib/queries";
import type { LiveEvent } from "../lib/types";
import { StatCard } from "./dashboard";
import { Badge, Card, Skeleton } from "./ui";
import { IconClock, IconTicket, IconUser } from "./icons";

function Gauge({ e }: { e: LiveEvent }) {
  const seg = liveSegments(e);
  return (
    <div
      className="flex h-2.5 w-full overflow-hidden rounded-full bg-elevated"
      role="img"
      aria-label={`${e.vendus} vendus, ${e.reserves} réservés sur ${e.places} places`}
    >
      <div className="h-full bg-primary transition-[width] duration-700" style={{ width: `${seg.vendu}%` }} />
      <div className="h-full bg-amber-400 transition-[width] duration-700" style={{ width: `${seg.reserve}%` }} />
    </div>
  );
}

/**
 * Section « En direct » : vendu / réservé / en liste d'attente des événements
 * à venir, rafraîchie toutes les 5 s (polling mis en pause quand l'onglet est
 * masqué). La RLS restreint les chiffres au collectif de l'organisateur.
 */
export function LiveDashboardSection() {
  const live = useQuery({
    queryKey: keys.analytics("live"),
    queryFn: api.live,
    refetchInterval: LIVE_REFRESH_MS,
  });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(t);
  }, []);

  const d = live.data;
  return (
    <section className="mb-6" data-testid="live-dashboard">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold">
          <span className="relative flex size-2.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />
            <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
          </span>
          En direct
        </h2>
        <span className="text-xs text-muted-foreground">
          {live.isError
            ? "Connexion perdue — dernières valeurs affichées"
            : live.dataUpdatedAt
              ? `Mis à jour ${freshness(live.dataUpdatedAt, now)}`
              : "Chargement…"}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {d ? (
          <>
            <StatCard label="Vendu" value={`${formatNumber(d.totaux.vendus)} / ${formatNumber(d.totaux.places)}`} icon={<IconTicket className="size-4" />} />
            <StatCard label="Réservé (paiement en cours)" value={formatNumber(d.totaux.reserves)} icon={<IconClock className="size-4" />} />
            <StatCard label="En liste d'attente" value={formatNumber(d.totaux.enAttente)} icon={<IconUser className="size-4" />} />
          </>
        ) : (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-[16px]" />)
        )}
      </div>

      {d && d.evenements.length > 0 && (
        <Card className="mt-4 divide-y divide-border">
          {d.evenements.map((e) => (
            <div key={e.evenementId} className="p-4" data-testid={`live-event-${e.evenementId}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{e.nom}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(e.debut)}</p>
                </div>
                <div className="flex items-center gap-2 text-sm tabular-nums">
                  <span>
                    <strong>{formatNumber(e.vendus)}</strong> vendus
                  </span>
                  <span className="text-amber-500">
                    <strong>{formatNumber(e.reserves)}</strong> réservés
                  </span>
                  <span className="text-muted-foreground">/ {formatNumber(e.places)}</span>
                  {e.enAttente > 0 && <Badge tone="warning">{formatNumber(e.enAttente)} en attente</Badge>}
                </div>
              </div>
              <div className="mt-2 flex items-center gap-3">
                <Gauge e={e} />
                <span className="w-12 shrink-0 text-right text-xs text-muted-foreground">{formatPercent(e.tauxOccupation)}</span>
              </div>
            </div>
          ))}
        </Card>
      )}
      {d && d.evenements.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">Aucun événement publié à venir.</p>
      )}
    </section>
  );
}
