import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useFieldArray, useForm, type FieldPath } from "react-hook-form";
import { z } from "zod";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ApiError, errorMessage } from "../lib/http";
import { formatDate, formatEUR, slugify } from "../lib/format";
import { ATTRIBUTE_LABEL } from "../lib/presentation";
import { keys, useCities, useEventTypes } from "../lib/queries";
import { useRouter } from "../lib/router";
import { useStore } from "../lib/store";
import { Alert, Badge, Button, Card, FormField, Input, Select } from "../components/ui";
import { DashboardShell } from "../components/dashboard";
import { IconCheck, IconClose, IconPlus } from "../components/icons";
import { Footer } from "../components/Layout";

const steps = ["Informations", "Date & lieu", "Billets", "Attributs", "Publication"];

// Mêmes contraintes que l'API et PostgreSQL (CHECK, trigger EAV), pour un retour immédiat.
const schema = z
  .object({
    nom: z.string().trim().min(3, "3 caractères minimum").max(200),
    typeEvenementId: z.string().min(1, "Choisissez un type"),
    description: z.string().trim().max(5000),
    date: z.string().min(1, "Date requise"),
    heureDebut: z.string().min(1, "Heure requise"),
    heureFin: z.string().min(1, "Heure requise"),
    ville: z.string().min(1, "Choisissez une ville"),
    lieuId: z.string().min(1, "Choisissez un lieu"),
    organisateurId: z.string().optional(),
    tarifs: z
      .array(
        z.object({
          nom: z.string().trim().min(1, "Nom requis").max(80),
          prix: z.coerce.number({ error: "Prix invalide" }).min(0, "Prix ≥ 0").max(100000),
          quota: z.coerce.number({ error: "Quota invalide" }).int("Nombre entier").min(1, "Quota ≥ 1").max(1_000_000),
        }),
      )
      .min(1, "Au moins un tarif")
      .refine((t) => new Set(t.map((x) => x.nom.trim())).size === t.length, "Deux tarifs portent le même nom"),
    attributs: z
      .array(
        z.object({
          cle: z.string().regex(/^[a-z][a-z0-9_]{0,49}$/, "a-z, 0-9 et _ uniquement"),
          valeur: z.string().trim().min(1, "Valeur requise").max(200),
        }),
      )
      .max(20)
      .refine((a) => new Set(a.map((x) => x.cle)).size === a.length, "Clés en double"),
    publier: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.date && v.heureDebut && new Date(`${v.date}T${v.heureDebut}`) <= new Date()) {
      ctx.addIssue({ code: "custom", path: ["date"], message: "La date doit être dans le futur" });
    }
    for (const [i, a] of v.attributs.entries()) {
      if (a.cle === "age_minimum" && !(/^\d{1,2}$/.test(a.valeur) && Number(a.valeur) <= 21)) {
        ctx.addIssue({ code: "custom", path: ["attributs", i, "valeur"], message: "Entier entre 0 et 21" });
      }
      if ((a.cle === "parking" || a.cle === "accessibilite_pmr") && !["oui", "non"].includes(a.valeur)) {
        ctx.addIssue({ code: "custom", path: ["attributs", i, "valeur"], message: "oui ou non" });
      }
    }
  });

type FormInput = z.input<typeof schema>;
type FormValues = z.output<typeof schema>;

const STEP_FIELDS: FieldPath<FormInput>[][] = [
  ["nom", "typeEvenementId", "description"],
  ["date", "heureDebut", "heureFin", "ville", "lieuId", "organisateurId"],
  ["tarifs"],
  ["attributs"],
  [],
];

/** Dates ISO de début et fin (fin le lendemain si l'heure de fin est antérieure). */
function toRange(date: string, heureDebut: string, heureFin: string) {
  const debut = new Date(`${date}T${heureDebut}`);
  let fin = new Date(`${date}T${heureFin}`);
  if (fin <= debut) fin = new Date(fin.getTime() + 86_400_000);
  return { debut: debut.toISOString(), fin: fin.toISOString() };
}

export function CreateEventPage() {
  const { navigate } = useRouter();
  const { toast } = useStore();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [progress, setProgress] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const form = useForm<FormInput, unknown, FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      nom: "",
      typeEvenementId: "",
      description: "",
      date: "",
      heureDebut: "20:00",
      heureFin: "23:00",
      ville: "",
      lieuId: "",
      organisateurId: "",
      tarifs: [{ nom: "Standard", prix: "" as unknown as number, quota: "" as unknown as number }],
      attributs: [],
      publier: false,
    },
    mode: "onTouched",
  });
  const { register, formState, watch, control } = form;
  const errors = formState.errors;
  const tarifs = useFieldArray({ control, name: "tarifs" });
  const attributs = useFieldArray({ control, name: "attributs" });

  const types = useEventTypes();
  const cities = useCities();
  const ville = watch("ville");
  const venues = useQuery({ queryKey: keys.venues(ville), queryFn: () => api.venues(ville), enabled: !!ville });
  // Seules les feuilles de l'arbre (types sans sous-type) sont proposées.
  const leafTypes = types.data?.filter((t) => !types.data?.some((c) => c.parentId === t.id));

  const values = watch();
  const isAdmin = user?.role === "admin";

  const next = async () => {
    const fields = STEP_FIELDS[step] ?? [];
    if (isAdmin && step === 1 && !values.organisateurId) {
      form.setError("organisateurId", { message: "Organisateur requis pour un administrateur" });
      return;
    }
    if (fields.length && !(await form.trigger(fields))) {
      toast("Corrigez les champs indiqués", "error");
      return;
    }
    setStep((s) => Math.min(s + 1, steps.length - 1));
  };

  // Création en plusieurs appels : événement (brouillon), tarifs, attributs, puis publication.
  // En cas d'échec, l'événement créé est supprimé pour ne pas laisser de brouillon incomplet.
  const submit = form.handleSubmit(async (v) => {
    setFailure(null);
    let createdId: number | null = null;
    try {
      const { debut, fin } = toRange(v.date, v.heureDebut, v.heureFin);
      setProgress("Création de l'événement…");
      const created = await api.createEvent({
        nom: v.nom,
        slug: slugify(v.nom, Date.now().toString(36)),
        description: v.description,
        debut,
        fin,
        lieuId: Number(v.lieuId),
        typeEvenementId: Number(v.typeEvenementId),
        statut: "draft",
        ...(isAdmin ? { organisateurId: Number(v.organisateurId) } : {}),
      } as Parameters<typeof api.createEvent>[0]);
      createdId = created.id;

      for (const [i, t] of v.tarifs.entries()) {
        setProgress(`Tarif ${i + 1} / ${v.tarifs.length}…`);
        await api.createPrice(created.id, {
          nom: t.nom,
          prix: t.prix,
          quota: t.quota,
          dateDebutVente: new Date().toISOString(),
          dateFinVente: debut,
        });
      }
      if (v.attributs.length > 0) {
        setProgress("Attributs…");
        await api.replaceAttributes(created.id, v.attributs);
      }
      if (v.publier) {
        setProgress("Publication…");
        await api.updateEvent(created.id, { statut: "published" });
      }

      void queryClient.invalidateQueries({ queryKey: ["events"] });
      void queryClient.invalidateQueries({ queryKey: ["analytics"] });
      toast(v.publier ? "Événement publié" : "Brouillon enregistré", "success");
      navigate(`/events/${created.slug}?scope=manage`);
    } catch (error) {
      if (createdId !== null) await api.deleteEvent(createdId).catch(() => undefined);
      const detail = error instanceof ApiError && error.details?.length ? ` (${error.details.map((d) => `${d.champ} : ${d.message}`).join(", ")})` : "";
      setFailure(errorMessage(error) + detail);
    } finally {
      setProgress(null);
    }
  });

  const prixMin = values.tarifs
    ?.map((t) => Number(t.prix))
    .filter((n) => Number.isFinite(n) && n >= 0)
    .reduce<number | null>((m, n) => (m === null ? n : Math.min(m, n)), null);
  const typeNom = leafTypes?.find((t) => String(t.id) === values.typeEvenementId)?.chemin;
  const lieu = venues.data?.items.find((l) => String(l.id) === values.lieuId);

  return (
    <>
      <DashboardShell title="Créer un événement" subtitle="Renseignez les informations étape par étape">
        <ol className="mb-8 flex flex-wrap items-center gap-x-2 gap-y-3">
          {steps.map((s, i) => (
            <li key={s} className="flex items-center gap-2" aria-current={i === step ? "step" : undefined}>
              <div
                className={`flex size-7 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                  i < step ? "bg-primary text-primary-foreground" : i === step ? "bg-primary/15 text-primary ring-2 ring-primary" : "bg-elevated text-muted-foreground"
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
          <form onSubmit={(e) => e.preventDefault()} noValidate>
            <Card className="p-6">
              {step === 0 && (
                <div className="space-y-5">
                  <FormField label="Nom de l'événement" error={errors.nom?.message} htmlFor="nom">
                    <Input id="nom" invalid={!!errors.nom} placeholder="Nuit électronique — Session 08" {...register("nom")} />
                  </FormField>
                  <FormField label="Type" error={errors.typeEvenementId?.message} htmlFor="type">
                    <Select id="type" {...register("typeEvenementId")}>
                      <option value="">Choisir…</option>
                      {leafTypes?.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.chemin}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField label="Description" error={errors.description?.message} htmlFor="desc">
                    <textarea
                      id="desc"
                      rows={5}
                      placeholder="Ambiance, programmation, temps forts…"
                      className={`rounded-[12px] border bg-background p-3.5 text-sm outline-none transition-colors focus:border-primary/60 ${
                        errors.description ? "border-danger/60" : "border-border"
                      }`}
                      {...register("description")}
                    />
                  </FormField>
                </div>
              )}

              {step === 1 && (
                <div className="grid gap-5 sm:grid-cols-2">
                  <FormField label="Date" error={errors.date?.message} htmlFor="date">
                    <Input id="date" type="date" invalid={!!errors.date} {...register("date")} />
                  </FormField>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="Début" error={errors.heureDebut?.message} htmlFor="heureDebut">
                      <Input id="heureDebut" type="time" invalid={!!errors.heureDebut} {...register("heureDebut")} />
                    </FormField>
                    <FormField label="Fin" error={errors.heureFin?.message} htmlFor="heureFin">
                      <Input id="heureFin" type="time" invalid={!!errors.heureFin} {...register("heureFin")} />
                    </FormField>
                  </div>
                  <FormField label="Ville" error={errors.ville?.message} htmlFor="ville">
                    <Select id="ville" {...register("ville", { onChange: () => form.setValue("lieuId", "") })}>
                      <option value="">Choisir…</option>
                      {cities.data?.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField label="Lieu" error={errors.lieuId?.message} htmlFor="lieu">
                    <Select id="lieu" disabled={!ville} {...register("lieuId")}>
                      <option value="">{ville ? "Choisir…" : "Choisissez d'abord une ville"}</option>
                      {venues.data?.items.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.nom} ({l.capacite.toLocaleString("fr-FR")} places)
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  {isAdmin && (
                    <FormField label="Identifiant de l'organisateur" error={errors.organisateurId?.message} htmlFor="orga">
                      <Input id="orga" type="number" min={1} invalid={!!errors.organisateurId} {...register("organisateurId")} />
                    </FormField>
                  )}
                </div>
              )}

              {step === 2 && (
                <div className="space-y-4">
                  {errors.tarifs?.root?.message && <Alert>{errors.tarifs.root.message}</Alert>}
                  {errors.tarifs?.message && <Alert>{errors.tarifs.message}</Alert>}
                  {tarifs.fields.map((field, i) => (
                    <div key={field.id} className="rounded-[12px] border border-border p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="font-mono text-xs uppercase tracking-wide text-muted-foreground">Tarif {i + 1}</span>
                        {tarifs.fields.length > 1 && (
                          <button type="button" aria-label={`Supprimer le tarif ${i + 1}`} onClick={() => tarifs.remove(i)} className="text-muted-foreground hover:text-danger">
                            <IconClose className="size-4" />
                          </button>
                        )}
                      </div>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <FormField label="Nom" error={errors.tarifs?.[i]?.nom?.message} htmlFor={`tarif-nom-${i}`}>
                          <Input id={`tarif-nom-${i}`} invalid={!!errors.tarifs?.[i]?.nom} placeholder="VIP" {...register(`tarifs.${i}.nom`)} />
                        </FormField>
                        <FormField label="Prix (€)" error={errors.tarifs?.[i]?.prix?.message} htmlFor={`tarif-prix-${i}`}>
                          <Input id={`tarif-prix-${i}`} type="number" min={0} step="0.01" invalid={!!errors.tarifs?.[i]?.prix} {...register(`tarifs.${i}.prix`)} />
                        </FormField>
                        <FormField label="Quota" error={errors.tarifs?.[i]?.quota?.message} htmlFor={`tarif-quota-${i}`}>
                          <Input id={`tarif-quota-${i}`} type="number" min={1} invalid={!!errors.tarifs?.[i]?.quota} {...register(`tarifs.${i}.quota`)} />
                        </FormField>
                      </div>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">Vente ouverte dès la création, jusqu'au début de l'événement.</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => tarifs.append({ nom: "", prix: "" as unknown as number, quota: "" as unknown as number })}>
                    <IconPlus className="size-4" /> Ajouter un tarif
                  </Button>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Informations pratiques (table clé/valeur). Les clés connues sont validées par la base : âge 0–21, parking et accessibilité oui/non.
                  </p>
                  {errors.attributs?.root?.message && <Alert>{errors.attributs.root.message}</Alert>}
                  {attributs.fields.map((field, i) => (
                    <div key={field.id} className="flex flex-wrap items-end gap-3">
                      <div className="min-w-44 flex-1">
                        <FormField label="Clé" error={errors.attributs?.[i]?.cle?.message} htmlFor={`attr-cle-${i}`}>
                          <Input id={`attr-cle-${i}`} list="cles-connues" invalid={!!errors.attributs?.[i]?.cle} placeholder="age_minimum" {...register(`attributs.${i}.cle`)} />
                        </FormField>
                      </div>
                      <div className="min-w-44 flex-1">
                        <FormField label="Valeur" error={errors.attributs?.[i]?.valeur?.message} htmlFor={`attr-val-${i}`}>
                          <Input id={`attr-val-${i}`} invalid={!!errors.attributs?.[i]?.valeur} placeholder="18" {...register(`attributs.${i}.valeur`)} />
                        </FormField>
                      </div>
                      <button type="button" aria-label={`Supprimer l'attribut ${i + 1}`} onClick={() => attributs.remove(i)} className="mb-3 text-muted-foreground hover:text-danger">
                        <IconClose className="size-5" />
                      </button>
                    </div>
                  ))}
                  <datalist id="cles-connues">
                    {Object.entries(ATTRIBUTE_LABEL).map(([cle, label]) => (
                      <option key={cle} value={cle}>
                        {label}
                      </option>
                    ))}
                  </datalist>
                  <Button type="button" variant="outline" size="sm" onClick={() => attributs.append({ cle: "", valeur: "" })}>
                    <IconPlus className="size-4" /> Ajouter un attribut
                  </Button>
                </div>
              )}

              {step === 4 && (
                <div className="space-y-5">
                  <label className="flex cursor-pointer items-start gap-3 rounded-[12px] border border-border p-4">
                    <input type="checkbox" className="mt-0.5 size-4 accent-[#d6ff3f]" {...register("publier")} />
                    <span>
                      <span className="font-medium">Publier immédiatement</span>
                      <span className="block text-sm text-muted-foreground">Sinon, l'événement reste un brouillon visible de vous seul.</span>
                    </span>
                  </label>
                  {progress && <Alert tone="info">{progress}</Alert>}
                  {failure && <Alert>La création a échoué : {failure}. Aucun événement n'a été conservé.</Alert>}
                </div>
              )}

              <div className="mt-8 flex items-center justify-between border-t border-border pt-6">
                <Button type="button" variant="ghost" disabled={!!progress} onClick={() => (step === 0 ? navigate("/organizer/events") : setStep(step - 1))}>
                  {step === 0 ? "Annuler" : "Précédent"}
                </Button>
                {step < steps.length - 1 ? (
                  <Button type="button" onClick={() => void next()}>
                    Continuer
                  </Button>
                ) : (
                  <Button type="button" loading={!!progress} onClick={() => void submit()}>
                    {values.publier ? "Créer et publier" : "Enregistrer le brouillon"}
                  </Button>
                )}
              </div>
            </Card>
          </form>

          <aside className="hidden lg:block">
            <div className="sticky top-24">
              <span className="mb-2 block font-mono text-xs uppercase tracking-widest text-muted-foreground">Aperçu</span>
              <Card className="overflow-hidden">
                <div className="p-4">
                  <Badge tone="accent">{typeNom ?? "Type"}</Badge>
                  <h3 className="mt-2 font-display text-base font-semibold leading-tight">{values.nom || "Nom de l'événement"}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {lieu ? `${lieu.nom}, ${lieu.ville}` : "Lieu"}
                    {values.date && ` · ${formatDate(`${values.date}T${values.heureDebut || "00:00"}`)}`}
                  </p>
                  <div className="mt-3 border-t border-border pt-3 text-sm">
                    <span className="text-muted-foreground">À partir de </span>
                    <span className="font-display font-bold">{prixMin === null || prixMin === undefined ? "—" : formatEUR(prixMin)}</span>
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
