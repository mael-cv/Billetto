import { useState } from "react";
import { adminUsers, events, formatEUR, recentOrders } from "../lib/data";
import { Badge, Button, Card, Select, Tabs } from "../components/ui";
import { DashboardShell, StatCard } from "../components/dashboard";
import { OrderStatusBadge } from "./OrganizerEvents";
import { IconChart, IconSearch, IconShield, IconTicket, IconUser } from "../components/icons";
import { Footer } from "../components/Layout";

function RoleBadge({ role }: { role: string }) {
  const map: Record<string, ["accent" | "warning" | "muted", string]> = {
    admin: ["warning", "Admin"],
    organizer: ["accent", "Organisateur"],
    visitor: ["muted", "Visiteur"],
  };
  const [tone, label] = map[role] ?? ["muted", role];
  return <Badge tone={tone}>{label}</Badge>;
}

export function AdminPage() {
  const [tab, setTab] = useState("users");
  const [q, setQ] = useState("");

  return (
    <>
      <DashboardShell title="Administration" subtitle="Supervision de la plateforme">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Utilisateurs" value="100 240" icon={<IconUser className="size-4" />} />
          <StatCard label="Événements" value="5 001" icon={<IconTicket className="size-4" />} />
          <StatCard label="Commandes" value="612 480" icon={<IconChart className="size-4" />} />
          <StatCard label="CA plateforme" value={formatEUR(4218000)} icon={<IconShield className="size-4" />} />
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "users", label: "Utilisateurs" },
              { id: "events", label: "Événements" },
              { id: "orders", label: "Commandes" },
              { id: "audit", label: "Audit" },
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
            {tab === "users" && (
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left font-mono text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-5 py-3 font-medium">Nom</th>
                    <th className="px-5 py-3 font-medium">E-mail</th>
                    <th className="px-5 py-3 font-medium">Rôle</th>
                    <th className="px-5 py-3 font-medium">Commandes</th>
                    <th className="px-5 py-3 font-medium">Inscrit le</th>
                    <th className="px-5 py-3 font-medium text-right">Rôle</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {adminUsers
                    .filter((u) => !q || u.nom.toLowerCase().includes(q.toLowerCase()) || u.email.includes(q))
                    .map((u) => (
                      <tr key={u.id} className="transition-colors hover:bg-elevated/50">
                        <td className="px-5 py-3.5 font-medium">{u.nom}</td>
                        <td className="px-5 py-3.5 text-muted-foreground">{u.email}</td>
                        <td className="px-5 py-3.5">
                          <RoleBadge role={u.role} />
                        </td>
                        <td className="px-5 py-3.5 tabular-nums">{u.commandes}</td>
                        <td className="px-5 py-3.5 font-mono text-xs text-muted-foreground">{u.inscrit}</td>
                        <td className="px-5 py-3.5">
                          <div className="flex justify-end">
                            <Select className="h-9 w-36 text-xs" defaultValue={u.role}>
                              <option value="visitor">Visiteur</option>
                              <option value="organizer">Organisateur</option>
                              <option value="admin">Admin</option>
                            </Select>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}

            {tab === "events" && (
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left font-mono text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-5 py-3 font-medium">Événement</th>
                    <th className="px-5 py-3 font-medium">Organisateur</th>
                    <th className="px-5 py-3 font-medium">Ville</th>
                    <th className="px-5 py-3 font-medium">À partir de</th>
                    <th className="px-5 py-3 font-medium">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {events
                    .filter((e) => !q || e.nom.toLowerCase().includes(q.toLowerCase()))
                    .map((e) => (
                      <tr key={e.id} className="transition-colors hover:bg-elevated/50">
                        <td className="px-5 py-3.5 font-medium">{e.nom}</td>
                        <td className="px-5 py-3.5 text-muted-foreground">{e.organisateur.nom}</td>
                        <td className="px-5 py-3.5 text-muted-foreground">{e.lieu.ville}</td>
                        <td className="px-5 py-3.5 font-semibold tabular-nums">{formatEUR(e.aPartirDe)}</td>
                        <td className="px-5 py-3.5">
                          <Badge tone={e.statut === "published" ? "success" : "muted"}>
                            {e.statut === "published" ? "Publié" : e.statut === "finished" ? "Terminé" : "Brouillon"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}

            {tab === "orders" && (
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
            )}

            {tab === "audit" && (
              <div className="divide-y divide-border">
                {[
                  ["Modification de tarif", "tarifs · VIP · 49 € → 55 €", "admin@billetto.io", "il y a 2 min"],
                  ["Remboursement de commande", "CMD-40918 · 29 €", "système", "il y a 18 min"],
                  ["Changement de rôle", "yanis@mail.com → organisateur", "admin@billetto.io", "il y a 1 h"],
                  ["Événement publié", "Design Summit 2026", "hello@halo.co", "il y a 3 h"],
                  ["Suppression de tarif", "tarifs · Blind Bird", "admin@billetto.io", "hier"],
                ].map(([action, detail, who, when], i) => (
                  <div key={i} className="flex items-center gap-4 px-5 py-4">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-elevated text-primary">
                      <IconShield className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{action}</div>
                      <div className="truncate font-mono text-xs text-muted-foreground">{detail}</div>
                    </div>
                    <div className="hidden text-right text-xs text-muted-foreground sm:block">
                      <div>{who}</div>
                      <div>{when}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </DashboardShell>
      <Footer />
    </>
  );
}
