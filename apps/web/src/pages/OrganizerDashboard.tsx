import { useState } from "react";
import { dailySales, formatEUR, recentOrders, topEvents } from "../lib/data";
import { Badge, Button, Card } from "../components/ui";
import { DashboardShell, StatCard } from "../components/dashboard";
import { useRouter } from "../lib/router";
import { IconChart, IconPlus, IconTicket, IconUser } from "../components/icons";
import { Footer } from "../components/Layout";
import { OrderStatusBadge } from "./OrganizerEvents";

// Lightweight dependency-free area chart with a hover tooltip.
function SalesChart({ data }: { data: typeof dailySales }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 240;
  const pad = { top: 16, right: 8, bottom: 26, left: 8 };
  const iw = W - pad.left - pad.right;
  const ih = H - pad.top - pad.bottom;
  const max = Math.max(...data.map((d) => d.billets)) * 1.15;
  const x = (i: number) => pad.left + (i / (data.length - 1)) * iw;
  const y = (v: number) => pad.top + ih - (v / max) * ih;

  const line = data.map((d, i) => `${x(i)},${y(d.billets)}`).join(" ");
  const area = `${pad.left},${pad.top + ih} ${line} ${pad.left + iw},${pad.top + ih}`;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Ventes quotidiennes" onMouseLeave={() => setHover(null)}>
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
          <g key={i}>
            {hover === i && <circle cx={x(i)} cy={y(d.billets)} r={4.5} fill="#d6ff3f" stroke="#09090b" strokeWidth={2} />}
            <rect
              x={x(i) - iw / data.length / 2}
              y={pad.top}
              width={iw / data.length}
              height={ih}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
            <text x={x(i)} y={H - 8} textAnchor="middle" className="fill-[#8b8b93]" style={{ fontSize: 10, fontFamily: "JetBrains Mono" }}>
              {i % 2 === 0 ? d.jour : ""}
            </text>
          </g>
        ))}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-[10px] border border-border bg-elevated px-3 py-2 text-sm shadow-lg"
          style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(data[hover].billets) / H) * 100}%` }}
        >
          <div className="font-mono text-xs text-muted-foreground">{data[hover].jour}</div>
          <div className="mt-0.5 font-semibold">{data[hover].billets} billets</div>
          <div className="text-primary">{formatEUR(data[hover].ca)}</div>
        </div>
      )}
    </div>
  );
}

export function OrganizerDashboardPage() {
  const { navigate } = useRouter();
  const totalCA = dailySales.reduce((s, d) => s + d.ca, 0);
  const totalBillets = dailySales.reduce((s, d) => s + d.billets, 0);

  return (
    <>
      <DashboardShell
        title="Dashboard"
        subtitle="Vue d'ensemble de vos ventes — Nuits Sonores"
        action={
          <Button onClick={() => navigate("/organizer/events/new")}>
            <IconPlus className="size-4" /> Créer un événement
          </Button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Chiffre d'affaires" value={formatEUR(totalCA)} delta={{ value: "+18,4 %", positive: true }} icon={<IconChart className="size-4" />} />
          <StatCard label="Billets vendus" value={totalBillets.toLocaleString("fr-FR")} delta={{ value: "+12,1 %", positive: true }} icon={<IconTicket className="size-4" />} />
          <StatCard label="Taux de remplissage" value="78 %" delta={{ value: "+4,2 pts", positive: true }} icon={<IconChart className="size-4" />} />
          <StatCard label="Nouveaux clients" value="1 284" delta={{ value: "−2,3 %", positive: false }} icon={<IconUser className="size-4" />} />
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-lg font-semibold">Ventes quotidiennes</h2>
                <p className="text-sm text-muted-foreground">12 derniers jours</p>
              </div>
              <Badge tone="accent">Temps réel</Badge>
            </div>
            <div className="mt-6">
              <SalesChart data={dailySales} />
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="font-display text-lg font-semibold">Top événements</h2>
            <p className="text-sm text-muted-foreground">Par chiffre d'affaires</p>
            <div className="mt-5 space-y-4">
              {topEvents.map((e, i) => (
                <div key={e.nom}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 truncate">
                      <span className="font-mono text-xs text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                      <span className="truncate font-medium">{e.nom}</span>
                    </span>
                    <span className="shrink-0 font-display font-semibold">{formatEUR(e.ca)}</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-elevated">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${e.remplissage * 100}%` }} />
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
              Tout voir
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-y border-border text-left font-mono text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Commande</th>
                  <th className="px-5 py-3 font-medium">Client</th>
                  <th className="px-5 py-3 font-medium">Événement</th>
                  <th className="px-5 py-3 font-medium">Montant</th>
                  <th className="px-5 py-3 font-medium">Statut</th>
                  <th className="px-5 py-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recentOrders.map((o) => (
                  <tr key={o.id} className="transition-colors hover:bg-elevated/50">
                    <td className="px-5 py-3.5 font-mono text-xs">{o.id}</td>
                    <td className="px-5 py-3.5 font-medium">{o.client}</td>
                    <td className="px-5 py-3.5 text-muted-foreground">{o.event}</td>
                    <td className="px-5 py-3.5 font-semibold tabular-nums">{formatEUR(o.montant)}</td>
                    <td className="px-5 py-3.5">
                      <OrderStatusBadge statut={o.statut} />
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs text-muted-foreground">{o.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </DashboardShell>
      <Footer />
    </>
  );
}
