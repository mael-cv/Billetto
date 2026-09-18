import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatDateTime, formatEUR, formatNumber, formatPercent } from "../lib/format";
import { keys } from "../lib/queries";
import { useRouter } from "../lib/router";
import type { DailySales } from "../lib/types";
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton } from "../components/ui";
import { DashboardShell, StatCard } from "../components/dashboard";
import { IconCalendar, IconChart, IconPlus, IconTicket } from "../components/icons";
import { Footer } from "../components/Layout";
import { OrderStatusBadge } from "./OrganizerEvents";

const DAY = 86_400_000;

export function lastDays(n: number): { from: string; to: string } {
  const to = new Date(Date.now() + DAY);
  to.setHours(0, 0, 0, 0);
  return { from: new Date(to.getTime() - (n + 1) * DAY).toISOString(), to: to.toISOString() };
}

/** Série continue : les jours sans vente valent 0 (l'API ne renvoie que les jours avec ventes). */
export function fillDays(rows: DailySales[], from: string, to: string): DailySales[] {
  const byDay = new Map(rows.map((r) => [r.jour, r]));
  const out: DailySales[] = [];
  for (let t = new Date(from).getTime(); t < new Date(to).getTime(); t += DAY) {
    const jour = new Date(t).toISOString().slice(0, 10);
    out.push(byDay.get(jour) ?? { jour, commandes: 0, billets: 0, chiffreAffaires: "0.00" });
  }
  return out;
}

// Graphique en aires sans dépendance, avec info-bulle au survol.
export function SalesChart({ data }: { data: DailySales[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 240;
  const pad = { top: 16, right: 8, bottom: 26, left: 8 };
  const iw = W - pad.left - pad.right;
  const ih = H - pad.top - pad.bottom;
  const max = Math.max(1, ...data.map((d) => d.billets)) * 1.15;
  const x = (i: number) => pad.left + (i / Math.max(1, data.length - 1)) * iw;
  const y = (v: number) => pad.top + ih - (v / max) * ih;
  const step = Math.max(1, Math.ceil(data.length / 8));

  const line = data.map((d, i) => `${x(i)},${y(d.billets)}`).join(" ");
  const area = `${pad.left},${pad.top + ih} ${line} ${pad.left + iw},${pad.top + ih}`;
  const point = hover === null ? null : data[hover];

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Billets vendus par jour" onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#d6ff3f" stopOpacity={0.32} />
            <stop offset="100%" stopColor="#d6ff3f" stopOpacity={0} />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((g) => (
          <line key={g} x1={pad.left} x2={pad.left + iw} y1={pad.top + ih * (1 - g)} y2={pad.top + ih * (1 - g)} stroke="rgba(244,244,242,0.06)" strokeWidth={1} />
        ))}
        <polygon points={area} fill="url(#salesFill)" />
        <polyline points={line} fill="none" stroke="#d6ff3f" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) => (
          <g key={d.jour}>
            {hover === i && <circle cx={x(i)} cy={y(d.billets)} r={4.5} fill="#d6ff3f" stroke="#09090b" strokeWidth={2} />}
            <rect x={x(i) - iw / data.length / 2} y={pad.top} width={iw / data.length} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} />
            <text x={x(i)} y={H - 8} textAnchor="middle" className="fill-[#8b8b93]" style={{ fontSize: 10, fontFamily: "JetBrains Mono" }}>
              {i % step === 0 ? `${d.jour.slice(8, 10)}/${d.jour.slice(5, 7)}` : ""}
            </text>
          </g>
        ))}
      </svg>
      {point && hover !== null && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-[10px] border border-border bg-elevated px-3 py-2 text-sm shadow-lg"
          style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(point.billets) / H) * 100}%` }}
        >
          <div className="font-mono text-xs text-muted-foreground">{point.jour.split("-").reverse().join("/")}</div>
          <div className="mt-0.5 font-semibold">{formatNumber(point.billets)} billets</div>
          <div className="text-primary">{formatEUR(point.chiffreAffaires)}</div>
        </div>
      )}
    </div>
  );
}

const RANGE = lastDays(30);

export function OrganizerDashboardPage() {
  const { navigate } = useRouter();
  const { user } = useAuth();
  const summary = useQuery({ queryKey: keys.analytics("summary"), queryFn: api.summary });
  const daily = useQuery({ queryKey: keys.analytics("daily", RANGE.from), queryFn: () => api.dailySales(RANGE.from, RANGE.to) });
  const top = useQuery({ queryKey: keys.analytics("events", "ca", 1, 5), queryFn: () => api.eventSales("ca", 1, 5) });
  const recent = useQuery({ queryKey: keys.analytics("recent", 8), queryFn: () => api.recentOrders(8) });

  const s = summary.data;
  const isAdmin = user?.role === "admin";

  return (
    <>
      <DashboardShell
        title="Tableau de bord"
        subtitle={isAdmin ? "Toute la plateforme" : "Vos événements uniquement — filtrés par PostgreSQL (RLS)"}
        action={
          <Button onClick={() => navigate("/organizer/events/new")}>
            <IconPlus className="size-4" /> Créer un événement
          </Button>
        }
      >
        {summary.isError ? (
          <ErrorState onRetry={() => void summary.refetch()} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="stats">
            {s ? (
              <>
                <StatCard label="Chiffre d'affaires" value={formatEUR(s.chiffreAffaires)} icon={<IconChart className="size-4" />} />
                <StatCard label="Billets vendus" value={formatNumber(s.billetsVendus)} icon={<IconTicket className="size-4" />} />
                <StatCard
                  label={isAdmin ? "Commandes payées" : "Taux de remplissage"}
                  value={isAdmin ? formatNumber(s.commandes) : formatPercent(s.tauxRemplissageMoyen)}
                  icon={<IconChart className="size-4" />}
                />
                <StatCard label="Événements à venir" value={`${formatNumber(s.evenementsAVenir)} / ${formatNumber(s.evenements)}`} icon={<IconCalendar className="size-4" />} />
              </>
            ) : (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-[16px]" />)
            )}
          </div>
        )}

        <div className="mt-6 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-lg font-semibold">Ventes quotidiennes</h2>
                <p className="text-sm text-muted-foreground">30 derniers jours</p>
              </div>
              <Badge tone="accent">{isAdmin ? "Vue matérialisée" : "Temps réel"}</Badge>
            </div>
            <div className="mt-6">
              {daily.isLoading && <Skeleton className="h-56 w-full" />}
              {daily.isError && <ErrorState onRetry={() => void daily.refetch()} />}
              {daily.data &&
                (daily.data.length === 0 ? (
                  <p className="py-16 text-center text-sm text-muted-foreground">Aucune vente sur la période.</p>
                ) : (
                  <SalesChart data={fillDays(daily.data, RANGE.from, RANGE.to)} />
                ))}
            </div>
            {isAdmin && (
              <p className="mt-3 text-xs text-muted-foreground">
                Chiffres pré-calculés : ils reflètent le dernier rafraîchissement de mv_ventes_quotidiennes.
              </p>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="font-display text-lg font-semibold">Top événements</h2>
            <p className="text-sm text-muted-foreground">Par chiffre d'affaires · barre = remplissage</p>
            <div className="mt-5 space-y-4">
              {top.isLoading && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              {top.isError && <ErrorState onRetry={() => void top.refetch()} />}
              {top.data?.items.length === 0 && <p className="text-sm text-muted-foreground">Aucun événement.</p>}
              {top.data?.items.map((e, i) => (
                <div key={e.evenementId}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                      <span className="truncate font-medium">{e.nom}</span>
                    </span>
                    <span className="shrink-0 font-display font-semibold">{formatEUR(e.chiffreAffaires)}</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-elevated" title={formatPercent(e.tauxRemplissage)}>
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (e.tauxRemplissage ?? 0) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <Card className="mt-6 overflow-hidden">
          <div className="flex items-center justify-between p-5">
            <h2 className="font-display text-lg font-semibold">Commandes récentes</h2>
            <Button variant="ghost" size="sm" onClick={() => navigate("/organizer/sales")}>
              Ventes détaillées
            </Button>
          </div>
          {recent.isError && <ErrorState onRetry={() => void recent.refetch()} />}
          {recent.data && recent.data.length === 0 && (
            <div className="p-5">
              <EmptyState title="Aucune commande" message="Les commandes de vos événements apparaîtront ici." />
            </div>
          )}
          {(recent.isLoading || (recent.data && recent.data.length > 0)) && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <caption className="sr-only">Commandes récentes</caption>
                <thead>
                  <tr className="border-y border-border text-left font-mono text-xs uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="px-5 py-3 font-medium">Commande</th>
                    <th scope="col" className="px-5 py-3 font-medium">Billets</th>
                    <th scope="col" className="px-5 py-3 font-medium">Montant</th>
                    <th scope="col" className="px-5 py-3 font-medium">Statut</th>
                    <th scope="col" className="px-5 py-3 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {recent.data?.map((o) => (
                    <tr key={o.id} className="transition-colors hover:bg-elevated/50">
                      <td className="px-5 py-3.5 font-mono text-xs">n° {o.id}</td>
                      <td className="px-5 py-3.5 tabular-nums">{o.billets}</td>
                      <td className="px-5 py-3.5 font-semibold tabular-nums">{formatEUR(o.montantTotal)}</td>
                      <td className="px-5 py-3.5">
                        <OrderStatusBadge statut={o.statut} />
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs text-muted-foreground">{formatDateTime(o.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {recent.isLoading && <Skeleton className="m-5 h-24" />}
            </div>
          )}
        </Card>
      </DashboardShell>
      <Footer />
    </>
  );
}
