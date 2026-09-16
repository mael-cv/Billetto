import { useStore } from "../lib/store";
import { useRouter } from "../lib/router";
import { Button, Card, Link } from "../components/ui";
import { IconTicket, IconUser } from "../components/icons";
import { Footer, Page } from "../components/Layout";

export function AccountPage() {
  const { user, signOut, toast } = useStore();
  const { navigate } = useRouter();

  if (!user) {
    return (
      <>
        <Page>
          <div className="mx-auto max-w-md pt-20 text-center">
            <h1 className="font-display text-3xl font-extrabold">Connectez-vous</h1>
            <p className="mt-2 text-muted-foreground">Accédez à votre compte et vos billets.</p>
            <div className="mt-6 flex justify-center gap-3">
              <Button onClick={() => navigate("/login")}>Connexion</Button>
              <Button variant="outline" onClick={() => navigate("/register")}>
                Créer un compte
              </Button>
            </div>
          </div>
        </Page>
        <Footer />
      </>
    );
  }

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
            <div className="font-display text-xl font-bold">{user.prenom}</div>
            <div className="text-muted-foreground">{user.email}</div>
          </div>
        </Card>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Link to="/tickets">
            <Card className="flex items-center gap-3 p-5 transition-colors hover:border-border-strong">
              <IconTicket className="size-6 text-primary" />
              <div>
                <div className="font-medium">Mes billets</div>
                <div className="text-sm text-muted-foreground">Consulter et télécharger</div>
              </div>
            </Card>
          </Link>
          <Link to="/organizer">
            <Card className="flex items-center gap-3 p-5 transition-colors hover:border-border-strong">
              <IconUser className="size-6 text-primary" />
              <div>
                <div className="font-medium">Espace organisateur</div>
                <div className="text-sm text-muted-foreground">Gérer mes événements</div>
              </div>
            </Card>
          </Link>
        </div>

        <Card className="mt-6 divide-y divide-border">
          {["Informations personnelles", "Préférences de notification", "Sécurité & mot de passe", "Moyens de paiement"].map((s) => (
            <button
              key={s}
              onClick={() => toast("Section bientôt disponible", "info")}
              className="flex w-full items-center justify-between p-4 text-left text-sm transition-colors hover:bg-elevated"
            >
              <span>{s}</span>
              <span className="text-muted-foreground">→</span>
            </button>
          ))}
        </Card>

        <Button
          variant="danger"
          className="mt-6"
          onClick={() => {
            signOut();
            toast("Déconnecté", "info");
            navigate("/");
          }}
        >
          Se déconnecter
        </Button>
      </Page>
      <Footer />
    </>
  );
}
