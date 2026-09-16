import { useState } from "react";
import { categories, cities } from "../lib/data";
import { useRouter } from "../lib/router";
import { useStore } from "../lib/store";
import { Badge, Button, Card, FormField, Input, Select } from "../components/ui";
import { DashboardShell } from "../components/dashboard";
import { IconCheck, IconClose, IconPlus } from "../components/icons";
import { Footer } from "../components/Layout";

const steps = ["Informations", "Date & lieu", "Billets", "Attributs", "Publication"];

interface TierDraft {
  nom: string;
  prix: string;
  quota: string;
}
interface AttrDraft {
  cle: string;
  valeur: string;
}

export function CreateEventPage() {
  const { navigate } = useRouter();
  const { toast } = useStore();
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [general, setGeneral] = useState({ nom: "", categorie: categories[1], description: "" });
  const [when, setWhen] = useState({ date: "", heure: "", ville: cities[1], lieu: "" });
  const [tiers, setTiers] = useState<TierDraft[]>([{ nom: "Standard", prix: "", quota: "" }]);
  const [attrs, setAttrs] = useState<AttrDraft[]>([{ cle: "", valeur: "" }]);

  const validateStep = (): boolean => {
    const e: Record<string, string> = {};
    if (step === 0) {
      if (!general.nom.trim()) e.nom = "Le nom est requis";
      if (general.description.trim().length < 10) e.description = "Décrivez votre événement (10 caractères min.)";
    }
    if (step === 1) {
      if (!when.date) e.date = "Date requise";
      if (!when.heure) e.heure = "Heure requise";
      if (!when.lieu.trim()) e.lieu = "Lieu requis";
    }
    if (step === 2) {
      tiers.forEach((t, i) => {
        if (!t.nom.trim()) e[`tier-nom-${i}`] = "Nom requis";
        if (!t.prix || Number(t.prix) < 0) e[`tier-prix-${i}`] = "Prix invalide";
        if (!t.quota || Number(t.quota) <= 0) e[`tier-quota-${i}`] = "Quota invalide";
      });
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const next = () => {
    if (!validateStep()) return toast("Corrigez les champs indiqués", "error");
    if (step < steps.length - 1) setStep(step + 1);
  };

  const publish = () => {
    // Publishing is a backend operation — the client only collects the draft.
    toast("Événement créé et soumis à publication", "success");
    navigate("/organizer/events");
  };

  return (
    <>
      <DashboardShell title="Créer un événement" subtitle="Renseignez les informations étape par étape">
        {/* Stepper */}
        <ol className="mb-8 flex flex-wrap items-center gap-x-2 gap-y-3">
          {steps.map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              <div
                className={`flex size-7 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                  i < step
                    ? "bg-primary text-primary-foreground"
                    : i === step
                      ? "bg-primary/15 text-primary ring-2 ring-primary"
                      : "bg-elevated text-muted-foreground"
                }`}
              >
                {i < step ? <IconCheck className="size-4" /> : i + 1}
              </div>
              <span className={`text-sm ${i === step ? "font-medium text-foreground" : "text-muted-foreground"}`}>{s}</span>
              {i < steps.length - 1 && <span className="mx-1 hidden h-px w-8 bg-border sm:block" />}
            </li>
          ))}
        </ol>

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <Card className="p-6">
            {step === 0 && (
              <div className="space-y-5">
                <FormField label="Nom de l'événement" error={errors.nom} htmlFor="nom">
                  <Input id="nom" value={general.nom} invalid={!!errors.nom} onChange={(e) => setGeneral({ ...general, nom: e.target.value })} placeholder="RESIDENT — Warehouse Session 08" />
                </FormField>
                <FormField label="Catégorie">
                  <Select value={general.categorie} onChange={(e) => setGeneral({ ...general, categorie: e.target.value })}>
                    {categories.slice(1).map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Description" error={errors.description} htmlFor="desc">
                  <textarea
                    id="desc"
                    value={general.description}
                    onChange={(e) => setGeneral({ ...general, description: e.target.value })}
                    rows={5}
                    placeholder="Décrivez l'ambiance, la programmation, les temps forts…"
                    className={`rounded-[12px] border bg-background p-3.5 text-sm outline-none transition-colors focus:border-primary/60 ${
                      errors.description ? "border-danger/60" : "border-border"
                    }`}
                  />
                </FormField>
              </div>
            )}

            {step === 1 && (
              <div className="grid gap-5 sm:grid-cols-2">
                <FormField label="Date" error={errors.date} htmlFor="date">
                  <Input id="date" type="date" value={when.date} invalid={!!errors.date} onChange={(e) => setWhen({ ...when, date: e.target.value })} />
                </FormField>
                <FormField label="Heure" error={errors.heure} htmlFor="heure">
                  <Input id="heure" type="time" value={when.heure} invalid={!!errors.heure} onChange={(e) => setWhen({ ...when, heure: e.target.value })} />
                </FormField>
                <FormField label="Ville">
                  <Select value={when.ville} onChange={(e) => setWhen({ ...when, ville: e.target.value })}>
                    {cities.slice(1).map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Lieu / salle" error={errors.lieu} htmlFor="lieu">
                  <Input id="lieu" value={when.lieu} invalid={!!errors.lieu} onChange={(e) => setWhen({ ...when, lieu: e.target.value })} placeholder="Dock B" />
                </FormField>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                {tiers.map((t, i) => (
                  <div key={i} className="rounded-[12px] border border-border p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="font-mono text-xs uppercase tracking-wide text-muted-foreground">Tarif {i + 1}</span>
                      {tiers.length > 1 && (
                        <button onClick={() => setTiers(tiers.filter((_, x) => x !== i))} className="text-muted-foreground hover:text-danger">
                          <IconClose className="size-4" />
                        </button>
                      )}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <FormField label="Nom" error={errors[`tier-nom-${i}`]}>
                        <Input value={t.nom} invalid={!!errors[`tier-nom-${i}`]} onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, nom: e.target.value } : x)))} placeholder="VIP" />
                      </FormField>
                      <FormField label="Prix (€)" error={errors[`tier-prix-${i}`]}>
                        <Input type="number" min={0} value={t.prix} invalid={!!errors[`tier-prix-${i}`]} onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, prix: e.target.value } : x)))} placeholder="28" />
                      </FormField>
                      <FormField label="Quota" error={errors[`tier-quota-${i}`]}>
                        <Input type="number" min={1} value={t.quota} invalid={!!errors[`tier-quota-${i}`]} onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, quota: e.target.value } : x)))} placeholder="500" />
                      </FormField>
                    </div>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => setTiers([...tiers, { nom: "", prix: "", quota: "" }])}>
                  <IconPlus className="size-4" /> Ajouter un tarif
                </Button>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">Ajoutez des informations pratiques (âge minimum, dress code, parking…).</p>
                {attrs.map((a, i) => (
                  <div key={i} className="flex items-end gap-3">
                    <FormField label="Clé">
                      <Input value={a.cle} onChange={(e) => setAttrs(attrs.map((x, j) => (j === i ? { ...x, cle: e.target.value } : x)))} placeholder="Âge minimum" />
                    </FormField>
                    <FormField label="Valeur">
                      <Input value={a.valeur} onChange={(e) => setAttrs(attrs.map((x, j) => (j === i ? { ...x, valeur: e.target.value } : x)))} placeholder="18 ans" />
                    </FormField>
                    <button onClick={() => setAttrs(attrs.filter((_, x) => x !== i))} className="mb-3 text-muted-foreground hover:text-danger">
                      <IconClose className="size-5" />
                    </button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => setAttrs([...attrs, { cle: "", valeur: "" }])}>
                  <IconPlus className="size-4" /> Ajouter un attribut
                </Button>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-5">
                <div className="rounded-[12px] border border-dashed border-border p-8 text-center">
                  <p className="font-medium">Glissez une image de couverture</p>
                  <p className="mt-1 text-sm text-muted-foreground">JPG ou PNG, 1600×900 recommandé</p>
                  <Button variant="outline" size="sm" className="mt-4" onClick={() => toast("Sélecteur de fichier — démo", "info")}>
                    Choisir un fichier
                  </Button>
                </div>
                <div className="rounded-[12px] bg-elevated p-4 text-sm">
                  <div className="flex items-center gap-2 text-success">
                    <IconCheck className="size-4" /> Tout est prêt pour la publication.
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    Votre événement sera vérifié puis mis en ligne. Vous pourrez le modifier à tout moment.
                  </p>
                </div>
              </div>
            )}

            <div className="mt-8 flex items-center justify-between border-t border-border pt-6">
              <Button variant="ghost" onClick={() => (step === 0 ? navigate("/organizer/events") : setStep(step - 1))}>
                {step === 0 ? "Annuler" : "Précédent"}
              </Button>
              {step < steps.length - 1 ? (
                <Button onClick={next}>Continuer</Button>
              ) : (
                <Button onClick={publish}>Publier l'événement</Button>
              )}
            </div>
          </Card>

          {/* Live preview */}
          <aside className="hidden lg:block">
            <div className="sticky top-24">
              <span className="mb-2 block font-mono text-xs uppercase tracking-widest text-muted-foreground">Aperçu</span>
              <Card className="overflow-hidden">
                <div className="flex aspect-[4/3] items-center justify-center bg-elevated text-muted-foreground">
                  <span className="text-sm">Image de couverture</span>
                </div>
                <div className="p-4">
                  <Badge tone="accent">{general.categorie}</Badge>
                  <h3 className="mt-2 font-display text-base font-semibold leading-tight">
                    {general.nom || "Nom de l'événement"}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {when.lieu || "Lieu"} · {when.ville}
                  </p>
                  <div className="mt-3 border-t border-border pt-3 text-sm">
                    <span className="text-muted-foreground">À partir de </span>
                    <span className="font-display font-bold">
                      {tiers.some((t) => t.prix) ? Math.min(...tiers.filter((t) => t.prix).map((t) => Number(t.prix))) + " €" : "—"}
                    </span>
                  </div>
                </div>
              </Card>
            </div>
          </aside>
        </div>
      </DashboardShell>
      <Footer />
    </>
  );
}
