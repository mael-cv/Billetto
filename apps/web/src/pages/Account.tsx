import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatDateTime, formatEUR } from "../lib/format";
import { keys } from "../lib/queries";
import { useRouter } from "../lib/router";
import { useStore } from "../lib/store";
import { Badge, Button, Card, EmptyState, ErrorState, Link, Skeleton } from "../components/ui";
import { IconChart, IconShield, IconTicket, IconUser } from "../components/icons";
import { Footer, Page } from "../components/Layout";
import { OrderStatusBadge } from "./OrganizerEvents";

const ROLE_LABEL = { visitor: "Visiteur", organizer: "Organisateur", admin: "Administrateur" } as const;

export function AccountPage() {
  const { user, logout } = useAuth();
  const { toast } = useStore();
  const { navigate } = useRouter();
  const orders = useQuery({ queryKey: keys.myOrders, queryFn: () => api.myOrders(1, 10) });

  if (!user) return null;

  return (
    <>
      <Page>
        <div className="pt-10">
          <h1 className="font-display text-4xl font-extrabold tracking-tight">Mon compte</h1>
        </div>

        <Card className="mt-6 flex items-center gap-4 p-6">
          <span className="flex size-16 items-center justify-center rounded-full bg-primary/15 text-primary">
            <IconUser className="size-7" />
          </span>
          <div>
            <div className="font-display text-xl font-bold">
              {user.prenom} {user.nom}
            </div>
            <div className="text-muted-foreground">{user.email}</div>
            <div className="mt-2">
              <Badge tone="accent">{ROLE_LABEL[user.role]}</Badge>
            </div>
          </div>
        </Card>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Link to="/tickets">
            <Card className="flex items-center gap-3 p-5 transition-colors hover:border-border-strong">
              <IconTicket className="size-6 text-primary" />
              <div>
                <div className="font-medium">Mes billets</div>
                <div className="text-sm text-muted-foreground">Consulter et rembourser</div>
              </div>
            </Card>
          </Link>
          {(user.role === "organizer" || user.role === "admin") && (
            <Link to="/organizer">
              <Card className="flex items-center gap-3 p-5 transition-colors hover:border-border-strong">
                <IconChart className="size-6 text-primary" />
                <div>
                  <div className="font-medium">Espace organisateur</div>
                  <div className="text-sm text-muted-foreground">Événements, tarifs et ventes</div>
                </div>
              </Card>
            </Link>
          )}
          {user.role === "admin" && (
            <Link to="/admin">
              <Card className="flex items-center gap-3 p-5 transition-colors hover:border-border-strong">
                <IconShield className="size-6 text-primary" />
                <div>
                  <div className="font-medium">Administration</div>
                  <div className="text-sm text-muted-foreground">Utilisateurs, commandes, audit</div>
                </div>
              </Card>
            </Link>
          )}
        </div>

        <section className="mt-10">
          <h2 className="font-display text-xl font-bold">Dernières commandes</h2>
          <div className="mt-4">
            {orders.isLoading && <Skeleton className="h-32 w-full rounded-[16px]" />}
            {orders.isError && <ErrorState onRetry={() => void orders.refetch()} />}
            {orders.data &&
              (orders.data.items.length === 0 ? (
                <EmptyState title="Aucune commande" message="Vos commandes apparaîtront ici." />
              ) : (
                <Card className="overflow-x-auto">
                  <table className="w-full min-w-[480px] text-sm">
                    <caption className="sr-only">Mes dernières commandes</caption>
                    <thead>
                      <tr className="border-b border-border text-left font-mono text-xs uppercase tracking-wide text-muted-foreground">
                        <th scope="col" className="px-5 py-3 font-medium">Commande</th>
                        <th scope="col" className="px-5 py-3 font-medium">Date</th>
                        <th scope="col" className="px-5 py-3 font-medium">Billets</th>
                        <th scope="col" className="px-5 py-3 font-medium">Montant</th>
                        <th scope="col" className="px-5 py-3 font-medium">Statut</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {orders.data.items.map((o) => (
                        <tr key={o.id}>
                          <td className="px-5 py-3.5 font-mono text-xs">n° {o.id}</td>
                          <td className="px-5 py-3.5 text-muted-foreground">{formatDateTime(o.createdAt)}</td>
                          <td className="px-5 py-3.5 tabular-nums">{o.nbBillets}</td>
                          <td className="px-5 py-3.5 font-semibold tabular-nums">{formatEUR(o.montantTotal)}</td>
                          <td className="px-5 py-3.5">
                            <OrderStatusBadge statut={o.statut} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              ))}
          </div>
        </section>

        <Button
          variant="danger"
          className="mt-8"
          loading={logout.isPending}
          onClick={() =>
            logout.mutate(undefined, {
              onSettled: () => {
                toast("Vous êtes déconnecté", "info");
                navigate("/");
              },
            })
          }
        >
          Se déconnecter
        </Button>
      </Page>
      <Footer />
    </>
  );
}
