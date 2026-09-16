import { useState } from "react";
import { useRouter } from "../lib/router";
import { useStore } from "../lib/store";
import { Button, FormField, Input, Link } from "../components/ui";
import { IconEye, IconEyeOff, IconTicket } from "../components/icons";

type Mode = "login" | "register" | "forgot";

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-[calc(100vh-4rem)] lg:grid-cols-2">
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
          <blockquote className="max-w-md font-display text-2xl font-bold leading-snug text-balance">
            « La billetterie la plus fluide qu'on ait utilisée. Nos soirées se remplissent en quelques minutes. »
          </blockquote>
          <p className="mt-3 font-mono text-sm text-muted-foreground">— Collectif Halo, organisateur</p>
        </div>
      </div>
    </div>
  );
}

export function AuthPage({ mode }: { mode: Mode }) {
  const { navigate } = useRouter();
  const { signIn, toast } = useStore();
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ prenom: "", email: "", password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const titles = {
    login: ["Bon retour", "Connectez-vous pour retrouver vos billets."],
    register: ["Créer un compte", "Rejoignez Billetto en quelques secondes."],
    forgot: ["Mot de passe oublié", "Nous vous enverrons un lien de réinitialisation."],
  }[mode];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (mode === "register" && !form.prenom.trim()) err.prenom = "Prénom requis";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) err.email = "E-mail invalide";
    if (mode !== "forgot" && form.password.length < 6) err.password = "6 caractères minimum";
    setErrors(err);
    if (Object.keys(err).length) return;

    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      if (mode === "forgot") {
        toast("Lien de réinitialisation envoyé", "success");
        navigate("/login");
        return;
      }
      // UI-only session — real auth handled by the backend (JWT / cookie HttpOnly).
      signIn(form.prenom || form.email.split("@")[0], form.email);
      toast(mode === "register" ? "Compte créé, bienvenue !" : "Connexion réussie", "success");
      navigate("/account");
    }, 900);
  };

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

      <form onSubmit={submit} className="mt-8 space-y-4">
        {mode === "register" && (
          <FormField label="Prénom" error={errors.prenom} htmlFor="prenom">
            <Input id="prenom" value={form.prenom} invalid={!!errors.prenom} onChange={(e) => setForm({ ...form, prenom: e.target.value })} placeholder="Camille" />
          </FormField>
        )}
        <FormField label="E-mail" error={errors.email} htmlFor="email">
          <Input id="email" type="email" value={form.email} invalid={!!errors.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="vous@mail.com" />
        </FormField>
        {mode !== "forgot" && (
          <FormField label="Mot de passe" error={errors.password} htmlFor="password">
            <div className="relative">
              <Input
                id="password"
                type={show ? "text" : "password"}
                value={form.password}
                invalid={!!errors.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="••••••••"
                className="w-full pr-11"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                aria-label={show ? "Masquer" : "Afficher"}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-[8px] p-1.5 text-muted-foreground hover:text-foreground"
              >
                {show ? <IconEyeOff className="size-5" /> : <IconEye className="size-5" />}
              </button>
            </div>
          </FormField>
        )}

        {mode === "login" && (
          <div className="flex justify-end">
            <Link to="/forgot" className="text-sm text-primary hover:underline">
              Mot de passe oublié ?
            </Link>
          </div>
        )}

        <Button type="submit" size="lg" className="w-full" loading={loading}>
          {mode === "login" ? "Se connecter" : mode === "register" ? "Créer mon compte" : "Envoyer le lien"}
        </Button>
      </form>

      <div className="mt-6 text-center text-sm text-muted-foreground">
        {mode === "login" && (
          <>
            Pas encore de compte ?{" "}
            <Link to="/register" className="font-medium text-primary hover:underline">
              Créer un compte
            </Link>
          </>
        )}
        {mode === "register" && (
          <>
            Déjà inscrit ?{" "}
            <Link to="/login" className="font-medium text-primary hover:underline">
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
