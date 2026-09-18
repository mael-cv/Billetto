import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { api } from "./api";
import { ApiError } from "./http";
import type { Role, User } from "./types";
import { useRouter } from "./router";
import { Button, Spinner } from "../components/ui";
import { Footer, Page } from "../components/Layout";

export const ME_KEY = ["auth", "me"] as const;

/** Utilisateur connecté, lu depuis la session (cookie HttpOnly) via GET /auth/me. */
export function useAuth() {
  const queryClient = useQueryClient();
  const me = useQuery({
    queryKey: ME_KEY,
    queryFn: async (): Promise<User | null> => {
      try {
        return await api.me();
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  const onSession = (user: User) => {
    // Nouvelle identité : aucune donnée de l'utilisateur précédent ne doit rester en cache.
    queryClient.clear();
    queryClient.setQueryData(ME_KEY, user);
  };

  const login = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) => api.login(email, password),
    onSuccess: onSession,
  });
  const register = useMutation({ mutationFn: api.register, onSuccess: onSession });
  const logout = useMutation({
    mutationFn: api.logout,
    onSettled: () => {
      queryClient.clear();
      queryClient.setQueryData(ME_KEY, null);
    },
  });

  return { user: me.data ?? null, loading: me.isLoading, login, register, logout };
}

/** Destination après connexion selon le rôle. */
export function homeFor(role: Role): string {
  if (role === "admin") return "/admin";
  if (role === "organizer") return "/organizer";
  return "/tickets";
}

/**
 * Garde d'affichage : redirige vers la connexion ou affiche un refus.
 * L'API refuse de toute façon (401/403) : ce composant n'est qu'un confort d'interface.
 */
export function RequireAuth({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  const { path, navigate } = useRouter();

  if (loading) {
    return (
      <div className="flex justify-center py-32 text-muted-foreground">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <Page>
          <div className="mx-auto max-w-md pt-20 text-center">
            <h1 className="font-display text-3xl font-extrabold">Connexion requise</h1>
            <p className="mt-2 text-muted-foreground">Connectez-vous pour accéder à cette page.</p>
            <div className="mt-6 flex justify-center gap-3">
              <Button onClick={() => navigate(`/login?next=${encodeURIComponent(path)}`)}>Se connecter</Button>
              <Button variant="outline" onClick={() => navigate(`/register?next=${encodeURIComponent(path)}`)}>
                Créer un compte
              </Button>
            </div>
          </div>
        </Page>
        <Footer />
      </>
    );
  }

  if (roles && !roles.includes(user.role)) {
    return (
      <>
        <Page>
          <div className="mx-auto max-w-md pt-20 text-center" role="alert">
            <div className="font-display text-6xl font-extrabold text-primary">403</div>
            <h1 className="mt-4 font-display text-2xl font-bold">Accès réservé</h1>
            <p className="mt-2 text-muted-foreground">Votre compte n'a pas les droits nécessaires pour cette page.</p>
            <Button className="mt-6" onClick={() => navigate("/")}>
              Retour à l'accueil
            </Button>
          </div>
        </Page>
        <Footer />
      </>
    );
  }

  return <>{children}</>;
}
