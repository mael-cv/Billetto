import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api";
import { useDebounced } from "../lib/hooks";
import { errorMessage } from "../lib/http";
import { formatDate, formatEUR, formatNumber, formatPercent, formatTime } from "../lib/format";
import { eventImage, STATUS_LABEL } from "../lib/presentation";
import { keys, useEvents } from "../lib/queries";
import { useRouter } from "../lib/router";
import { useStore } from "../lib/store";
import type { EventStatus, EventSummary, OrderStatus } from "../lib/types";
import { Badge, Button, Card, EmptyState, ErrorState, Pagination, Select, Skeleton, Tabs } from "../components/ui";
import { DashboardShell, StatCard } from "../components/dashboard";
import { IconChart, IconPlus, IconSearch, IconTicket } from "../components/icons";
import { Footer } from "../components/Layout";
import { fillDays, lastDays, SalesChart } from "./OrganizerDashboard";

export function OrderStatusBadge({ statut }: { statut: OrderStatus }) {
  const map = {
    paid: ["success", "Payée"],
    pending: ["warning", "En attente"],
    refunded: ["danger", "Remboursée"],
    cancelled: ["muted", "Annulée"],
  } as const;
  const [tone, label] = map[statut];
  return <Badge tone={tone}>{label}</Badge>;
}

export function StatusBadge({ statut }: { statut: EventStatus }) {
  const tone = { published: "success", draft: "muted", cancelled: "danger", finished: "neutral" } as const;
  return <Badge tone={tone[statut]}>{STATUS_LABEL[statut]}</Badge>;
}

export function OrganizerEventsPage() {
  const { navigate } = useRouter();
  const { toast } = useStore();
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"all" | EventStatus>("all");
  const [page, setPage] = useState(1);
  const search = useDebounced(q.trim());

  // scope=manage : la RLS limite la liste aux événements de l'organisateur (tous pour un admin).
  const events = useEvents({
    scope: "manage",
    q: search || undefined,
    statut: tab === "all" ? undefined : tab,
    sort: "-date",
    page,
    pageSize: 20,
  });

  const toggle = useMutation({
    mutationFn: (e: EventSummary) => api.updateEvent(e.id, { statut: e.statut === "published" ? "draft" : "published" }),
    onSuccess: (updated) => {
      toast(updated.statut === "published" ? "Événement publié" : "Événement repassé en brouillon", "success");
      void queryClient.invalidateQueries({ queryKey: ["events"] });
      void queryClient.invalidateQueries({ queryKey: ["event"] });
    },
    onError: (error) => toast(errorMessage(error), "error"),
  });

  return (
    <>
      <DashboardShell
        title="Mes événements"
        subtitle={events.data ? `${formatNumber(events.data.total)} événement(s)` : "Chargement…"}
        action={
          <Button onClick={() => navigate("/organizer/events/new")}>
            <IconPlus className="size-4" /> Créer un événement
          </Button>
        }
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs
            value={tab}
            onChange={(v) => {
              setTab(v as typeof tab);
              setPage(1);
            }}
            tabs={[
              { id: "all", label: "Tous" },
              { id: "published", label: "Publiés" },
              { id: "draft", label: "Brouillons" },
              { id: "finished", label: "Terminés" },
            ]}
          />
          <label className="flex items-center gap-2 rounded-[12px] border border-border bg-card px-3 sm:w-64">
            <IconSearch className="size-4 text-muted-foreground" />
            <span className="sr-only">Rechercher</span>
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="Rechercher…"
              className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </label>
        </div>

        <Card className="mt-6 overflow-hidden">
          {events.isError && <ErrorState onRetry={() => void events.refetch()} />}
          {events.isLoading && <Skeleton className="m-5 h-64" />}
          {events.data && events.data.items.length === 0 && (
            <div className="p-5">
              <EmptyState
                title="Aucun événement"
                message="Aucun événement ne correspond à ces critères."
                action={<Button onClick={() => navigate("/organizer/events/new")}>Créer un événement</Button>}
              />
            </div>
          )}
          {events.data && events.data.items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm" data-testid="organizer-events">
                <caption className="sr-only">Mes événements</caption>
                <thead>
                  <tr className="border-b border-border text-left font-mono text-xs uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="px-5 py-3 font-medium">Événement</th>
                    <th scope="col" className="px-5 py-3 font-medium">Date</th>
                    <th scope="col" className="px-5 py-3 font-medium">Lieu</th>
                    <th scope="col" className="px-5 py-3 font-medium">À partir de</th>
                    <th scope="col" className="px-5 py-3 font-medium">Statut</th>
                    <th scope="col" className="px-5 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {events.data.items.map((e) => {
                    const canToggle = e.statut === "published" || e.statut === "draft";
                    return (
                      <tr key={e.id} className="transition-colors hover:bg-elevated/50">
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <div className="size-10 shrink-0 overflow-hidden rounded-[8px] bg-elevated">
                              <img src={eventImage(e, 80, 80)} alt="" className="size-full object-cover" />
                            </div>
                            <span className="font-medium">{e.nom}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-muted-foreground">
                          {formatDate(e.debut)} · {formatTime(e.debut)}
                        </td>
                        <td className="px-5 py-3.5 text-muted-foreground">
                          {e.lieu.nom}, {e.lieu.ville}
                        </td>
                        <td className="px-5 py-3.5 font-semibold tabular-nums">{e.prixMin ? formatEUR(e.prixMin) : "—"}</td>
                        <td className="px-5 py-3.5">
                          <StatusBadge statut={e.statut} />
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button variant="ghost" size="sm" onClick={() => navigate(`/events/${e.slug}?scope=manage`)}>
                              Voir
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={!canToggle}
                              loading={toggle.isPending && toggle.variables?.id === e.id}
                              onClick={() => toggle.mutate(e)}
                            >
                              {e.statut === "published" ? "Dépublier" : "Publier"}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        {events.data && <Pagination page={events.data.page} totalPages={events.data.totalPages} onChange={setPage} />}
      </DashboardShell>
      <Footer />
    </>
  );
}

const SALES_SORTS = { ca: "Chiffre d'affaires", billets: "Billets vendus", taux: "Taux de remplissage", date: "Date" } as const;

export function OrganizerSalesPage() {
  const [range, setRange] = useState(30);
  const [sort, setSort] = useState<keyof typeof SALES_SORTS>("ca");
  const [page, setPage] = useState(1);
  const period = lastDays(range);

  const daily = useQuery({
    queryKey: keys.analytics("daily", range),
    queryFn: () => api.dailySales(period.from, period.to),
  });
  const sales = useQuery({
    queryKey: keys.analytics("events", sort, page, 20),
    queryFn: () => api.eventSales(sort, page, 20),
    placeholderData: (prev) => prev,
  });

  const totals = (daily.data ?? []).reduce(
    (acc, d) => ({ billets: acc.billets + d.billets, commandes: acc.commandes + d.commandes, ca: acc.ca + Number(d.chiffreAffaires) }),
    { billets: 0, commandes: 0, ca: 0 },
  );

  return (
    <>
      <DashboardShell
        title="Ventes"
        subtitle="Ventes par jour et par événement"
        action={
          <Select aria-label="Période" value={range} onChange={(e) => setRange(Number(e.target.value))} className="w-44">
            <option value={7}>7 derniers jours</option>
            <option value={30}>30 derniers jours</option>
            <option value={90}>90 derniers jours</option>
            <option value={365}>12 derniers mois</option>
          </Select>
        }
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="CA de la période" value={daily.data ? formatEUR(totals.ca) : "…"} icon={<IconChart className="size-4" />} />
          <StatCard label="Billets vendus" value={daily.data ? formatNumber(totals.billets) : "…"} icon={<IconTicket className="size-4" />} />
          <StatCard label="Commandes" value={daily.data ? formatNumber(totals.commandes) : "…"} icon={<IconChart className="size-4" />} />
        </div>

        <Card className="mt-6 p-5">
          <h2 className="font-display text-lg font-semibold">Billets vendus par jour</h2>
          <div className="mt-6">
            {daily.isLoading && <Skeleton className="h-56 w-full" />}
            {daily.isError && <ErrorState onRetry={() => void daily.refetch()} />}
            {daily.data && <SalesChart data={fillDays(daily.data, period.from, period.to)} />}
          </div>
        </Card>

        <Card className="mt-6 overflow-hidden">
          <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="font-display text-lg font-semibold">Ventes par événement</h2>
            <Select
              aria-label="Trier par"
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as keyof typeof SALES_SORTS);
                setPage(1);
              }}
              className="w-56"
            >
              {Object.entries(SALES_SORTS).map(([k, label]) => (
                <option key={k} value={k}>
                  Trier : {label}
                </option>
              ))}
            </Select>
          </div>
          {sales.isError && <ErrorState onRetry={() => void sales.refetch()} />}
          {sales.isLoading && <Skeleton className="m-5 h-64" />}
          {sales.data && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <caption className="sr-only">Ventes par événement</caption>
                <thead>
                  <tr className="border-y border-border text-left font-mono text-xs uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="px-5 py-3 font-medium">Événement</th>
                    <th scope="col" className="px-5 py-3 font-medium">Date</th>
                    <th scope="col" className="px-5 py-3 font-medium">Statut</th>
                    <th scope="col" className="px-5 py-3 text-right font-medium">Billets</th>
                    <th scope="col" className="px-5 py-3 text-right font-medium">Places</th>
                    <th scope="col" className="px-5 py-3 text-right font-medium">Remplissage</th>
                    <th scope="col" className="px-5 py-3 text-right font-medium">CA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sales.data.items.map((e) => (
                    <tr key={e.evenementId} className="transition-colors hover:bg-elevated/50">
                      <td className="px-5 py-3.5 font-medium">{e.nom}</td>
                      <td className="px-5 py-3.5 text-muted-foreground">{formatDate(e.debut)}</td>
                      <td className="px-5 py-3.5">
                        <StatusBadge statut={e.statut} />
                      </td>
                      <td className="px-5 py-3.5 text-right tabular-nums">{formatNumber(e.billetsVendus)}</td>
                      <td className="px-5 py-3.5 text-right tabular-nums">{formatNumber(e.places)}</td>
                      <td className="px-5 py-3.5 text-right tabular-nums">{formatPercent(e.tauxRemplissage)}</td>
                      <td className="px-5 py-3.5 text-right font-semibold tabular-nums">{formatEUR(e.chiffreAffaires)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        {sales.data && <Pagination page={sales.data.page} totalPages={sales.data.totalPages} onChange={setPage} />}
      </DashboardShell>
      <Footer />
    </>
  );
}
