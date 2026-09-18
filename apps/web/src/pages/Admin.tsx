import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api";
import { useDebounced } from "../lib/hooks";
import { errorMessage } from "../lib/http";
import { formatDateTime, formatEUR, formatNumber } from "../lib/format";
import { keys, useEvents } from "../lib/queries";
import { useRouter } from "../lib/router";
import { useStore } from "../lib/store";
import type { AdminUser, Role } from "../lib/types";
import { Badge, Button, Card, EmptyState, ErrorState, Input, Pagination, Select, Skeleton, Tabs } from "../components/ui";
import { DashboardShell, StatCard } from "../components/dashboard";
import { IconChart, IconSearch, IconShield, IconTicket, IconUser } from "../components/icons";
import { Footer } from "../components/Layout";
import { OrderStatusBadge, StatusBadge } from "./OrganizerEvents";

function RoleBadge({ role }: { role: Role }) {
  const map = { admin: ["warning", "Admin"], organizer: ["accent", "Organisateur"], visitor: ["muted", "Visiteur"] } as const;
  const [tone, label] = map[role];
  return <Badge tone={tone}>{label}</Badge>;
}

function RoleEditor({ user }: { user: AdminUser }) {
  const { toast } = useStore();
  const queryClient = useQueryClient();
  const [role, setRole] = useState<Role>(user.role);
  const [organisateurId, setOrganisateurId] = useState(user.organisateurId ? String(user.organisateurId) : "");
  const change = useMutation({
    mutationFn: () => api.changeRole(user.id, role, role === "organizer" && organisateurId ? Number(organisateurId) : null),
    onSuccess: () => {
      toast(`Rôle de ${user.email} modifié (effectif à sa prochaine connexion)`, "success");
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    // La cohérence rôle / organisateur est vérifiée par une contrainte PostgreSQL.
    onError: (error) => toast(errorMessage(error), "error"),
  });
  const dirty = role !== user.role || (role === "organizer" && organisateurId !== String(user.organisateurId ?? ""));

  return (
    <div className="flex items-center justify-end gap-2">
      <Select aria-label={`Rôle de ${user.email}`} className="h-9 w-36 text-xs" value={role} onChange={(e) => setRole(e.target.value as Role)}>
        <option value="visitor">Visiteur</option>
        <option value="organizer">Organisateur</option>
        <option value="admin">Admin</option>
      </Select>
      {role === "organizer" && (
        <Input
          aria-label="Identifiant organisateur"
          type="number"
          min={1}
          className="h-9 w-24 text-xs"
          placeholder="Orga n°"
          value={organisateurId}
          onChange={(e) => setOrganisateurId(e.target.value)}
        />
      )}
      <Button size="sm" variant="outline" disabled={!dirty} loading={change.isPending} onClick={() => change.mutate()}>
        Appliquer
      </Button>
    </div>
  );
}

export function AdminPage() {
  const { toast } = useStore();
  const { navigate } = useRouter();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("users");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const search = useDebounced(q.trim());

  const summary = useQuery({ queryKey: keys.analytics("summary"), queryFn: api.summary });
  const users = useQuery({
    queryKey: keys.users(search, page),
    queryFn: () => api.users(search || undefined, page),
    enabled: tab === "users",
    placeholderData: (prev) => prev,
  });
  const events = useEvents({ scope: "manage", q: tab === "events" ? search || undefined : undefined, sort: "-date", page, pageSize: 25 });
  const orders = useQuery({ queryKey: keys.analytics("recent", 50), queryFn: () => api.recentOrders(50), enabled: tab === "orders" });
  const audit = useQuery({ queryKey: keys.analytics("audit"), queryFn: () => api.priceAudit(50), enabled: tab === "audit" });

  const refund = useMutation({
    mutationFn: (id: number) => api.refund(id),
    onSuccess: (o) => {
      toast(`Commande n° ${o.id} remboursée`, "success");
      void queryClient.invalidateQueries({ queryKey: ["analytics"] });
    },
    onError: (error) => toast(errorMessage(error), "error"),
  });

  const s = summary.data;

  return (
    <>
      <DashboardShell title="Administration" subtitle="Supervision de la plateforme">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Utilisateurs" value={users.data ? formatNumber(users.data.total) : "…"} icon={<IconUser className="size-4" />} />
          <StatCard label="Événements" value={s ? formatNumber(s.evenements) : "…"} icon={<IconTicket className="size-4" />} />
          <StatCard label="Commandes payées" value={s ? formatNumber(s.commandes) : "…"} icon={<IconChart className="size-4" />} />
          <StatCard label="CA plateforme" value={s ? formatEUR(s.chiffreAffaires) : "…"} icon={<IconShield className="size-4" />} />
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs
            value={tab}
            onChange={(t) => {
              setTab(t);
              setPage(1);
              setQ("");
            }}
            tabs={[
              { id: "users", label: "Utilisateurs" },
              { id: "events", label: "Événements" },
              { id: "orders", label: "Commandes" },
              { id: "audit", label: "Audit des tarifs" },
            ]}
          />
          {(tab === "users" || tab === "events") && (
            <label className="flex items-center gap-2 rounded-[12px] border border-border bg-card px-3 sm:w-72">
              <IconSearch className="size-4 text-muted-foreground" />
              <span className="sr-only">Rechercher</span>
              <input
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
                placeholder={tab === "users" ? "Rechercher un e-mail…" : "Rechercher un événement…"}
                className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </label>
          )}
        </div>

        <Card className="mt-6 overflow-hidden">
          <div className="overflow-x-auto">
            {tab === "users" && (
              <>
                {users.isError && <ErrorState onRetry={() => void users.refetch()} />}
                {users.isLoading && <Skeleton className="m-5 h-64" />}
                {users.data && (
                  <table className="w-full min-w-[860px] text-sm">
                    <caption className="sr-only">Utilisateurs</caption>
                    <thead>
                      <tr className="border-b border-border text-left font-mono text-xs uppercase tracking-wide text-muted-foreground">
                        <th scope="col" className="px-5 py-3 font-medium">Nom</th>
                        <th scope="col" className="px-5 py-3 font-medium">E-mail</th>
                        <th scope="col" className="px-5 py-3 font-medium">Rôle</th>
                        <th scope="col" className="px-5 py-3 font-medium">Inscrit le</th>
                        <th scope="col" className="px-5 py-3 text-right font-medium">Modifier le rôle</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {users.data.items.map((u) => (
                        <tr key={u.id} className="transition-colors hover:bg-elevated/50">
                          <td className="px-5 py-3.5 font-medium">
                            {u.prenom} {u.nom}
                          </td>
                          <td className="px-5 py-3.5 text-muted-foreground">{u.email}</td>
                          <td className="px-5 py-3.5">
                            <RoleBadge role={u.role} />
                            {u.organisateurId && <span className="ml-2 font-mono text-xs text-muted-foreground">orga n° {u.organisateurId}</span>}
                          </td>
                          <td className="px-5 py-3.5 font-mono text-xs text-muted-foreground">{formatDateTime(u.createdAt)}</td>
                          <td className="px-5 py-3.5">
                            <RoleEditor user={u} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}

            {tab === "events" && (
              <>
                {events.isError && <ErrorState onRetry={() => void events.refetch()} />}
                {events.isLoading && <Skeleton className="m-5 h-64" />}
                {events.data && (
                  <table className="w-full min-w-[720px] text-sm">
                    <caption className="sr-only">Événements</caption>
                    <thead>
                      <tr className="border-b border-border text-left font-mono text-xs uppercase tracking-wide text-muted-foreground">
                        <th scope="col" className="px-5 py-3 font-medium">Événement</th>
                        <th scope="col" className="px-5 py-3 font-medium">Organisateur</th>
                        <th scope="col" className="px-5 py-3 font-medium">Ville</th>
                        <th scope="col" className="px-5 py-3 font-medium">À partir de</th>
                        <th scope="col" className="px-5 py-3 font-medium">Statut</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {events.data.items.map((e) => (
                        <tr key={e.id} className="cursor-pointer transition-colors hover:bg-elevated/50" onClick={() => navigate(`/events/${e.slug}?scope=manage`)}>
                          <td className="px-5 py-3.5 font-medium">{e.nom}</td>
                          <td className="px-5 py-3.5 text-muted-foreground">{e.organisateur}</td>
                          <td className="px-5 py-3.5 text-muted-foreground">{e.lieu.ville}</td>
                          <td className="px-5 py-3.5 font-semibold tabular-nums">{e.prixMin ? formatEUR(e.prixMin) : "—"}</td>
                          <td className="px-5 py-3.5">
                            <StatusBadge statut={e.statut} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}

            {tab === "orders" && (
              <>
                {orders.isError && <ErrorState onRetry={() => void orders.refetch()} />}
                {orders.isLoading && <Skeleton className="m-5 h-64" />}
                {orders.data && (
                  <table className="w-full min-w-[720px] text-sm">
                    <caption className="sr-only">Dernières commandes</caption>
                    <thead>
                      <tr className="border-b border-border text-left font-mono text-xs uppercase tracking-wide text-muted-foreground">
                        <th scope="col" className="px-5 py-3 font-medium">Commande</th>
                        <th scope="col" className="px-5 py-3 font-medium">Billets</th>
                        <th scope="col" className="px-5 py-3 font-medium">Montant</th>
                        <th scope="col" className="px-5 py-3 font-medium">Statut</th>
                        <th scope="col" className="px-5 py-3 font-medium">Date</th>
                        <th scope="col" className="px-5 py-3 text-right font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {orders.data.map((o) => (
                        <tr key={o.id} className="transition-colors hover:bg-elevated/50">
                          <td className="px-5 py-3.5 font-mono text-xs">n° {o.id}</td>
                          <td className="px-5 py-3.5 tabular-nums">{o.billets}</td>
                          <td className="px-5 py-3.5 font-semibold tabular-nums">{formatEUR(o.montantTotal)}</td>
                          <td className="px-5 py-3.5">
                            <OrderStatusBadge statut={o.statut} />
                          </td>
                          <td className="px-5 py-3.5 font-mono text-xs text-muted-foreground">{formatDateTime(o.createdAt)}</td>
                          <td className="px-5 py-3.5 text-right">
                            {o.statut === "paid" && (
                              <Button
                                size="sm"
                                variant="danger"
                                loading={refund.isPending && refund.variables === o.id}
                                onClick={() => window.confirm(`Rembourser la commande n° ${o.id} ?`) && refund.mutate(o.id)}
                              >
                                Rembourser
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}

            {tab === "audit" && (
              <>
                {audit.isError && <ErrorState onRetry={() => void audit.refetch()} />}
                {audit.isLoading && <Skeleton className="m-5 h-64" />}
                {audit.data?.length === 0 && (
                  <div className="p-5">
                    <EmptyState title="Journal vide" message="Les modifications de prix et de quota apparaîtront ici (trigger d'audit)." />
                  </div>
                )}
                {audit.data && audit.data.length > 0 && (
                  <ul className="divide-y divide-border">
                    {audit.data.map((a) => (
                      <li key={a.id} className="flex items-center gap-4 px-5 py-4">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-elevated text-primary">
                          <IconShield className="size-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">
                            {a.action === "DELETE" ? "Suppression de tarif" : "Modification de tarif"} · {a.tarif ?? `tarif n° ${a.tarifId}`}
                          </div>
                          <div className="truncate font-mono text-xs text-muted-foreground">
                            {a.evenement ?? "événement supprimé"}
                            {a.action === "UPDATE" && (
                              <>
                                {a.ancienPrix !== a.nouveauPrix && ` · prix ${formatEUR(a.ancienPrix)} → ${formatEUR(a.nouveauPrix)}`}
                                {a.ancienQuota !== a.nouveauQuota && ` · quota ${a.ancienQuota} → ${a.nouveauQuota}`}
                              </>
                            )}
                          </div>
                        </div>
                        <div className="hidden text-right text-xs text-muted-foreground sm:block">
                          <div>{a.auteur}</div>
                          <div>{formatDateTime(a.createdAt)}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </Card>
        {tab === "users" && users.data && <Pagination page={users.data.page} totalPages={users.data.totalPages} onChange={setPage} />}
        {tab === "events" && events.data && <Pagination page={events.data.page} totalPages={events.data.totalPages} onChange={setPage} />}
      </DashboardShell>
      <Footer />
    </>
  );
}
