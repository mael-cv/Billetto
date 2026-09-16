import { useState } from "react";
import { events, formatDate, formatEUR, recentOrders as recentOrdersList, type EventStatus } from "../lib/data";
import { useRouter } from "../lib/router";
import { Badge, Button, Card, Select, Tabs } from "../components/ui";
import { DashboardShell } from "../components/dashboard";
import { useStore } from "../lib/store";
import { IconPlus, IconSearch } from "../components/icons";
import { Footer } from "../components/Layout";

export function OrderStatusBadge({ statut }: { statut: "paid" | "pending" | "refunded" | "cancelled" }) {
  const map = {
    paid: ["success", "Payée"],
    pending: ["warning", "En attente"],
    refunded: ["danger", "Remboursée"],
    cancelled: ["muted", "Annulée"],
  } as const;
  const [tone, label] = map[statut];
  return <Badge tone={tone}>{label}</Badge>;
}

function StatusBadge({ statut }: { statut: EventStatus }) {
  const map = {
    published: ["success", "Publié"],
    draft: ["muted", "Brouillon"],
    cancelled: ["danger", "Annulé"],
    finished: ["neutral", "Terminé"],
  } as const;
  const [tone, label] = map[statut];
  return <Badge tone={tone}>{label}</Badge>;
}

export function OrganizerEventsPage() {
  const { navigate } = useRouter();
  const { toast } = useStore();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<string>("all");

  // Local presentation state only; publish/unpublish is a backend operation.
  const [statuses, setStatuses] = useState<Record<string, EventStatus>>(
    Object.fromEntries(events.map((e) => [e.id, e.statut])),
  );

  const filtered = events.filter((e) => {
    const s = statuses[e.id];
    if (tab !== "all" && s !== tab) return false;
    if (q && !e.nom.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const togglePublish = (id: string) => {
    setStatuses((prev) => {
      const next = prev[id] === "published" ? "draft" : "published";
      toast(next === "published" ? "Événement publié" : "Événement dépublié", "success");
      return { ...prev, [id]: next as EventStatus };
    });
  };

  return (
    <>
      <DashboardShell
        title="Mes événements"
        subtitle={`${events.length} événements · Nuits Sonores`}
        action={
          <Button onClick={() => navigate("/organizer/events/new")}>
            <IconPlus className="size-4" /> Créer un événement
          </Button>
        }
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "all", label: "Tous" },
              { id: "published", label: "Publiés" },
              { id: "draft", label: "Brouillons" },
              { id: "finished", label: "Terminés" },
            ]}
          />
          <div className="flex items-center gap-2 rounded-[12px] border border-border bg-card px-3 sm:w-64">
            <IconSearch className="size-4 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Rechercher…"
              className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>

        <Card className="mt-6 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-border text-left font-mono text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Événement</th>
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium">Lieu</th>
                  <th className="px-5 py-3 font-medium">À partir de</th>
                  <th className="px-5 py-3 font-medium">Statut</th>
                  <th className="px-5 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((e) => (
                  <tr key={e.id} className="transition-colors hover:bg-elevated/50">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="size-10 shrink-0 overflow-hidden rounded-[8px] bg-elevated">
                          <img src={e.image} alt="" className="size-full object-cover" />
                        </div>
                        <span className="font-medium">{e.nom}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground">{formatDate(e.date)}</td>
                    <td className="px-5 py-3.5 text-muted-foreground">{e.lieu.ville}</td>
                    <td className="px-5 py-3.5 font-semibold tabular-nums">{formatEUR(e.aPartirDe)}</td>
                    <td className="px-5 py-3.5">
                      <StatusBadge statut={statuses[e.id]} />
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button variant="ghost" size="sm" onClick={() => navigate(`/events/${e.slug}`)}>
                          Voir
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => togglePublish(e.id)}>
                          {statuses[e.id] === "published" ? "Dépublier" : "Publier"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && (
            <div className="p-12 text-center text-sm text-muted-foreground">Aucun événement dans cette catégorie.</div>
          )}
        </Card>
      </DashboardShell>
      <Footer />
    </>
  );
}

export function OrganizerSalesPage() {
  const [range, setRange] = useState("30");
  return (
    <>
      <DashboardShell
        title="Ventes"
        subtitle="Analyse détaillée de vos commandes"
        action={
          <Select value={range} onChange={(e) => setRange(e.target.value)} className="w-40">
            <option value="7">7 derniers jours</option>
            <option value="30">30 derniers jours</option>
            <option value="90">90 derniers jours</option>
          </Select>
        }
      >
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left font-mono text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Commande</th>
                  <th className="px-5 py-3 font-medium">Client</th>
                  <th className="px-5 py-3 font-medium">Événement</th>
                  <th className="px-5 py-3 font-medium">Montant</th>
                  <th className="px-5 py-3 font-medium">Statut</th>
                  <th className="px-5 py-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[...recentOrdersList, ...recentOrdersList].map((o, i) => (
                  <tr key={i} className="transition-colors hover:bg-elevated/50">
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
