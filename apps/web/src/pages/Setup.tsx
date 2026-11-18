import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { ApiError, errorMessage } from "../lib/http";
import type { SetupMode, SetupStatus } from "../lib/types";
import { Alert, Button, Card, FormField, Input, Spinner } from "../components/ui";
import { IconTicket } from "../components/icons";

export const SETUP_KEY = ["setup", "status"] as const;

type Step = "jeton" | "mode" | "admin";

interface FieldErrors {
  [champ: string]: string;
}

/** Erreurs de validation de l'API reportées sur les champs (chemins « admin.email », « stripe.secretKey »…). */
function fieldErrors(error: unknown): FieldErrors {
  const out: FieldErrors = {};
  if (error instanceof ApiError && error.details) {
    for (const d of error.details) out[d.champ] = d.message;
  }
  return out;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-5 py-12">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-[9px] bg-primary text-primary-foreground">
            <IconTicket className="size-5" />
          </span>
          <span className="font-display text-xl font-extrabold tracking-tight">Billetto</span>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Installation en cours : chargement des données, création de l'administrateur, redémarrage de l'API. */
export function SetupProgress() {
  return (
    <Shell>
      <h1 className="font-display text-3xl font-extrabold tracking-tight">Installation en cours</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        L'application prépare ses données et crée le compte administrateur, puis redémarre. Cette page se met à jour
        toute seule ; cela prend généralement moins d'une minute.
      </p>
      <div className="mt-8 flex items-center gap-3 text-muted-foreground" data-testid="setup-progress">
        <Spinner className="size-5" /> Veuillez patienter…
      </div>
    </Shell>
  );
}

/**
 * Assistant de premier démarrage. Rien n'est décidé ici : l'API vérifie le jeton
 * d'installation, le format des clés et la robustesse du mot de passe, et refuse
 * définitivement toute nouvelle installation une fois l'application initialisée.
 */
export function SetupPage() {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>("jeton");
  const [jeton, setJeton] = useState("");
  const [mode, setMode] = useState<SetupMode>("test");
  const [secretKey, setSecretKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [admin, setAdmin] = useState({ prenom: "", nom: "", email: "", password: "" });
  const [confirmation, setConfirmation] = useState("");

  const submit = useMutation({
    mutationFn: () =>
      api.submitSetup({
        jeton: jeton.trim(),
        mode,
        ...(mode === "live" ? { stripe: { secretKey: secretKey.trim(), webhookSecret: webhookSecret.trim() } } : {}),
        admin,
      }),
    onSuccess: (status: SetupStatus) => queryClient.setQueryData(SETUP_KEY, status),
    onError: (error) => {
      // Jeton refusé : retour à la première étape.
      if (error instanceof ApiError && error.code === "JETON_INVALIDE") setStep("jeton");
      else if (error instanceof ApiError && (error.code === "DEJA_INITIALISEE" || error.code === "INSTALLATION_EN_COURS")) {
        void queryClient.invalidateQueries({ queryKey: SETUP_KEY });
      }
    },
  });

  const errors = fieldErrors(submit.error);
  const mismatch = confirmation.length > 0 && confirmation !== admin.password;
  const globalError = submit.error && Object.keys(errors).length === 0 ? errorMessage(submit.error) : null;

  const next = (event: FormEvent, to: Step) => {
    event.preventDefault();
    submit.reset();
    setStep(to);
  };

  return (
    <Shell>
      <h1 className="font-display text-3xl font-extrabold tracking-tight">Premier démarrage</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Trois étapes pour initialiser l'application. Cet assistant ne fonctionne qu'une fois.
      </p>
      <ol className="mt-6 flex gap-2 text-xs text-muted-foreground" aria-label="Étapes">
        {(["jeton", "mode", "admin"] as Step[]).map((s, i) => (
          <li
            key={s}
            className={`flex-1 rounded-full border px-3 py-1.5 text-center ${step === s ? "border-primary text-foreground" : "border-border"}`}
          >
            {i + 1}. {s === "jeton" ? "Jeton" : s === "mode" ? "Mode" : "Administrateur"}
          </li>
        ))}
      </ol>

      {globalError && (
        <div className="mt-6">
          <Alert>{globalError}</Alert>
        </div>
      )}

      {step === "jeton" && (
        <form className="mt-6 space-y-4" onSubmit={(e) => next(e, "mode")}>
          <Card className="p-4 text-sm text-muted-foreground">
            Le jeton d'installation s'affiche dans les journaux de démarrage :
            <code className="mt-2 block rounded-[8px] bg-elevated px-3 py-2 font-mono text-xs text-foreground">
              docker compose logs bootstrap
            </code>
          </Card>
          <FormField label="Jeton d'installation" htmlFor="jeton" error={errors.jeton}>
            <Input
              id="jeton"
              autoComplete="off"
              spellCheck={false}
              required
              minLength={20}
              maxLength={100}
              value={jeton}
              onChange={(e) => setJeton(e.target.value)}
              className="w-full font-mono"
            />
          </FormField>
          <Button type="submit" size="lg" className="w-full" disabled={jeton.trim().length < 20}>
            Continuer
          </Button>
        </form>
      )}

      {step === "mode" && (
        <form className="mt-6 space-y-4" onSubmit={(e) => next(e, "admin")}>
          <div className="grid gap-3">
            {(
              [
                ["test", "Mode test", "Données de démonstration chargées, paiement Stripe de test (aucune carte réelle débitée)."],
                ["live", "Mode réel", "Base vide, paiements réels avec vos clés Stripe. Aucune donnée de démonstration."],
              ] as [SetupMode, string, string][]
            ).map(([value, title, text]) => (
              <label
                key={value}
                className={`flex cursor-pointer items-start gap-3 rounded-[16px] border p-4 text-sm ${
                  mode === value ? "border-primary bg-primary/5" : "border-border"
                }`}
              >
                <input
                  type="radio"
                  name="mode"
                  value={value}
                  checked={mode === value}
                  onChange={() => setMode(value)}
                  className="mt-1 size-4 accent-[#d6ff3f]"
                />
                <span>
                  <span className="block font-medium">{title}</span>
                  <span className="text-xs text-muted-foreground">{text}</span>
                </span>
              </label>
            ))}
          </div>

          {mode === "live" && (
            <>
              <FormField
                label="Clé secrète Stripe réelle"
                htmlFor="secretKey"
                hint="sk_live_… ou clé restreinte rk_live_…"
                error={errors["stripe.secretKey"] ?? errors.stripe}
              >
                <Input
                  id="secretKey"
                  type="password"
                  autoComplete="off"
                  required
                  value={secretKey}
                  onChange={(e) => setSecretKey(e.target.value)}
                  className="w-full font-mono"
                />
              </FormField>
              <FormField
                label="Secret de signature des webhooks"
                htmlFor="webhookSecret"
                hint="whsec_… (point de terminaison déclaré dans le tableau de bord Stripe)"
                error={errors["stripe.webhookSecret"]}
              >
                <Input
                  id="webhookSecret"
                  type="password"
                  autoComplete="off"
                  required
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  className="w-full font-mono"
                />
              </FormField>
            </>
          )}

          <div className="flex gap-3">
            <Button type="button" variant="outline" onClick={() => setStep("jeton")}>
              Retour
            </Button>
            <Button type="submit" size="lg" className="flex-1">
              Continuer
            </Button>
          </div>
        </form>
      )}

      {step === "admin" && (
        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!mismatch) submit.mutate();
          }}
        >
          <p className="text-sm text-muted-foreground">
            Ce compte administre toute l'application : il gère les utilisateurs et attribue les rôles d'organisateur.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Prénom" htmlFor="prenom" error={errors["admin.prenom"]}>
              <Input
                id="prenom"
                autoComplete="given-name"
                required
                maxLength={80}
                value={admin.prenom}
                onChange={(e) => setAdmin({ ...admin, prenom: e.target.value })}
              />
            </FormField>
            <FormField label="Nom" htmlFor="nom" error={errors["admin.nom"]}>
              <Input
                id="nom"
                autoComplete="family-name"
                required
                maxLength={80}
                value={admin.nom}
                onChange={(e) => setAdmin({ ...admin, nom: e.target.value })}
              />
            </FormField>
          </div>
          <FormField label="E-mail" htmlFor="email" error={errors["admin.email"]}>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={admin.email}
              onChange={(e) => setAdmin({ ...admin, email: e.target.value })}
              className="w-full"
            />
          </FormField>
          <FormField label="Mot de passe" htmlFor="password" hint="12 caractères minimum" error={errors["admin.password"]}>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
              value={admin.password}
              onChange={(e) => setAdmin({ ...admin, password: e.target.value })}
              className="w-full"
            />
          </FormField>
          <FormField
            label="Confirmation du mot de passe"
            htmlFor="confirmation"
            error={mismatch ? "Les deux mots de passe diffèrent" : undefined}
          >
            <Input
              id="confirmation"
              type="password"
              autoComplete="new-password"
              required
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              className="w-full"
            />
          </FormField>
          <div className="flex gap-3">
            <Button type="button" variant="outline" onClick={() => setStep("mode")} disabled={submit.isPending}>
              Retour
            </Button>
            <Button type="submit" size="lg" className="flex-1" loading={submit.isPending} disabled={mismatch || confirmation.length === 0}>
              Initialiser l'application
            </Button>
          </div>
        </form>
      )}
    </Shell>
  );
}
