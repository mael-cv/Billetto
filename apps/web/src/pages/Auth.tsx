import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, type FieldValues, type Path, type UseFormSetError } from "react-hook-form";
import { z } from "zod";
import { homeFor, useAuth } from "../lib/auth";
import { useQueryParams } from "../lib/hooks";
import { ApiError, errorMessage } from "../lib/http";
import { useRouter } from "../lib/router";
import { useStore } from "../lib/store";
import { Alert, Button, FormField, Input, Link } from "../components/ui";
import { IconEye, IconEyeOff, IconTicket } from "../components/icons";

type Mode = "login" | "register" | "forgot";

// Mêmes règles que l'API (qui revalide tout) : retour immédiat à l'utilisateur.
const loginSchema = z.object({
  email: z.email("Adresse e-mail invalide"),
  password: z.string().min(1, "Mot de passe requis").max(128),
});

const registerSchema = z.object({
  prenom: z.string().trim().min(1, "Prénom requis").max(80),
  nom: z.string().trim().min(1, "Nom requis").max(80),
  email: z.email("Adresse e-mail invalide").max(254),
  password: z.string().min(12, "12 caractères minimum").max(128, "128 caractères maximum"),
});

type LoginForm = z.infer<typeof loginSchema>;
type RegisterForm = z.infer<typeof registerSchema>;

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex items-center justify-center px-5 py-16">
        <div className="w-full max-w-sm">{children}</div>
      </div>
      <div className="relative hidden overflow-hidden lg:block">
        <img
          src="https://images.unsplash.com/photo-1524368535928-5b5e00ddc76b?w=1200&h=1600&fit=crop&auto=format"
          alt=""
          className="size-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/30 to-transparent" />
        <div className="absolute bottom-0 p-12">
          <p className="max-w-md font-display text-2xl font-bold leading-snug text-balance">
            Concerts, festivals, sport : réservez en quelques secondes, sans jamais risquer la survente.
          </p>
        </div>
      </div>
    </div>
  );
}

function PasswordInput({ id, invalid, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input id={id} type={show ? "text" : "password"} invalid={invalid} className="w-full pr-11" {...props} />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Masquer le mot de passe" : "Afficher le mot de passe"}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-[8px] p-1.5 text-muted-foreground hover:text-foreground"
      >
        {show ? <IconEyeOff className="size-5" /> : <IconEye className="size-5" />}
      </button>
    </div>
  );
}

/** Reporte les erreurs de validation de l'API sur les champs du formulaire. */
function applyApiErrors<T extends FieldValues>(error: unknown, setError: UseFormSetError<T>, fields: string[]): void {
  if (error instanceof ApiError && error.details) {
    for (const d of error.details) {
      if (fields.includes(d.champ)) setError(d.champ as Path<T>, { message: d.message });
    }
  }
}

function useAfterLogin() {
  const params = useQueryParams();
  const { navigate } = useRouter();
  return (role: Parameters<typeof homeFor>[0]) => {
    const next = params.get("next");
    // Redirection interne uniquement (pas de redirection ouverte vers un autre site).
    navigate(next && next.startsWith("/") && !next.startsWith("//") ? next : homeFor(role));
  };
}

function LoginFormView() {
  const { login } = useAuth();
  const { toast } = useStore();
  const afterLogin = useAfterLogin();
  const form = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });
  const { errors } = form.formState;

  const submit = form.handleSubmit((values) =>
    login.mutate(values, {
      onSuccess: (user) => {
        toast(`Bonjour ${user.prenom} !`, "success");
        afterLogin(user.role);
      },
    }),
  );

  return (
    <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
      {login.error && <Alert>{errorMessage(login.error)}</Alert>}
      <FormField label="E-mail" error={errors.email?.message} htmlFor="email">
        <Input id="email" type="email" autoComplete="email" invalid={!!errors.email} placeholder="vous@mail.com" {...form.register("email")} />
      </FormField>
      <FormField label="Mot de passe" error={errors.password?.message} htmlFor="password">
        <PasswordInput id="password" autoComplete="current-password" invalid={!!errors.password} placeholder="••••••••" {...form.register("password")} />
      </FormField>
      <div className="flex justify-end">
        <Link to="/forgot" className="text-sm text-primary hover:underline">
          Mot de passe oublié ?
        </Link>
      </div>
      <Button type="submit" size="lg" className="w-full" loading={login.isPending}>
        Se connecter
      </Button>
    </form>
  );
}

function RegisterFormView() {
  const { register: signUp } = useAuth();
  const { toast } = useStore();
  const afterLogin = useAfterLogin();
  const form = useForm<RegisterForm>({ resolver: zodResolver(registerSchema) });
  const { errors } = form.formState;

  const submit = form.handleSubmit((values) =>
    signUp.mutate(values, {
      onSuccess: (user) => {
        toast("Compte créé, bienvenue !", "success");
        afterLogin(user.role);
      },
      onError: (error) => {
        applyApiErrors(error, form.setError, ["prenom", "nom", "email", "password"]);
        if (error instanceof ApiError && error.status === 409) {
          form.setError("email", { message: "Un compte existe déjà avec cette adresse" });
        }
      },
    }),
  );

  const apiError = signUp.error instanceof ApiError && signUp.error.status !== 409 && !signUp.error.details ? signUp.error : null;

  return (
    <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
      {apiError && <Alert>{apiError.message}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Prénom" error={errors.prenom?.message} htmlFor="prenom">
          <Input id="prenom" autoComplete="given-name" invalid={!!errors.prenom} {...form.register("prenom")} />
        </FormField>
        <FormField label="Nom" error={errors.nom?.message} htmlFor="nom">
          <Input id="nom" autoComplete="family-name" invalid={!!errors.nom} {...form.register("nom")} />
        </FormField>
      </div>
      <FormField label="E-mail" error={errors.email?.message} htmlFor="email">
        <Input id="email" type="email" autoComplete="email" invalid={!!errors.email} placeholder="vous@mail.com" {...form.register("email")} />
      </FormField>
      <FormField label="Mot de passe" error={errors.password?.message} hint="12 caractères minimum" htmlFor="password">
        <PasswordInput id="password" autoComplete="new-password" invalid={!!errors.password} {...form.register("password")} />
      </FormField>
      <Button type="submit" size="lg" className="w-full" loading={signUp.isPending}>
        Créer mon compte
      </Button>
    </form>
  );
}

export function AuthPage({ mode }: { mode: Mode }) {
  const params = useQueryParams();
  const next = params.get("next");
  const suffix = next ? `?next=${encodeURIComponent(next)}` : "";

  const titles = {
    login: ["Bon retour", "Connectez-vous pour retrouver vos billets."],
    register: ["Créer un compte", "Rejoignez Billetto en quelques secondes."],
    forgot: ["Mot de passe oublié", "Réinitialisation du mot de passe."],
  }[mode];

  return (
    <AuthShell>
      <Link to="/" className="mb-8 flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-[9px] bg-primary text-primary-foreground">
          <IconTicket className="size-5" />
        </span>
        <span className="font-display text-xl font-extrabold tracking-tight">Billetto</span>
      </Link>

      <h1 className="font-display text-3xl font-extrabold tracking-tight">{titles[0]}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{titles[1]}</p>

      {mode === "login" && <LoginFormView />}
      {mode === "register" && <RegisterFormView />}
      {mode === "forgot" && (
        <div className="mt-8">
          <Alert tone="info">
            La réinitialisation par e-mail n'est pas disponible dans cette version (aucun service d'envoi configuré).
            Contactez un administrateur pour réinitialiser votre accès.
          </Alert>
        </div>
      )}

      <div className="mt-6 text-center text-sm text-muted-foreground">
        {mode === "login" && (
          <>
            Pas encore de compte ?{" "}
            <Link to={`/register${suffix}`} className="font-medium text-primary hover:underline">
              Créer un compte
            </Link>
          </>
        )}
        {mode === "register" && (
          <>
            Déjà inscrit ?{" "}
            <Link to={`/login${suffix}`} className="font-medium text-primary hover:underline">
              Se connecter
            </Link>
          </>
        )}
        {mode === "forgot" && (
          <Link to="/login" className="font-medium text-primary hover:underline">
            ← Retour à la connexion
          </Link>
        )}
      </div>
    </AuthShell>
  );
}
