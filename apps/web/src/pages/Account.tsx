import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatDateTime, formatEUR } from "../lib/format";
import { keys } from "../lib/queries";
import { useRouter } from "../lib/router";
import { useStore } from "../lib/store";
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Input, Link, Skeleton } from "../components/ui";
import { IconChart, IconShield, IconTicket, IconUser } from "../components/icons";
import { Footer, Page } from "../components/Layout";
import { OrderStatusBadge } from "./OrganizerEvents";

const ROLE_LABEL = { visitor: "Visiteur", organizer: "Organisateur", admin: "Administrateur" } as const;

export function AccountPage() {
  const { user, logout } = useAuth();
  const { toast } = useStore();
  const { navigate } = useRouter();
  const orders = useQuery({ queryKey: keys.myOrders, queryFn: () => api.myOrders(1, 10) });
  const queryClient = useQueryClient();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);

  if (!user) return null;

  const changePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordError("");
    if (newPassword.length < 12 || newPassword.length > 128) {
      setPasswordError("Le nouveau mot de passe doit contenir entre 12 et 128 caractères.");
      return;
    }
    setPasswordBusy(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      queryClient.clear();
      navigate("/login");
    } catch {
      setPasswordError("Changement impossible. Vérifiez le mot de passe actuel et réessayez.");
    } finally {
      setPasswordBusy(false);
    }
  };

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

        <section className="mt-10 max-w-xl">
          <h2 className="font-display text-xl font-bold">Sécurité du compte</h2>
          <Card className="mt-4 p-6">
            <form onSubmit={changePassword} className="space-y-4">
              <label className="block space-y-2 text-sm font-medium" htmlFor="current-password">
                Mot de passe actuel
                <Input id="current-password" type="password" autoComplete="current-password" required maxLength={128} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
              </label>
              <label className="block space-y-2 text-sm font-medium" htmlFor="new-password">
                Nouveau mot de passe (12 caractères minimum)
                <Input id="new-password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              </label>
              {passwordError && <Alert>{passwordError}</Alert>}
              <Button type="submit" loading={passwordBusy}>Changer le mot de passe et fermer les autres sessions</Button>
            </form>
          </Card>
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
