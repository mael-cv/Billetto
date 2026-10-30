import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { errorMessage } from "../lib/http";
import { keys } from "../lib/queries";
import { useRouter } from "../lib/router";
import { useStore } from "../lib/store";
import type { EventPageInput, EventTemplate, MediaItem, ProgrammeItem } from "../lib/types";
import { Button, Card, ErrorState, FormField, Input, Select, Skeleton } from "../components/ui";
import { DashboardShell } from "../components/dashboard";
import { Footer } from "../components/Layout";

const EMPTY: EventPageInput = { templateId: "default", tags: [], programme: [], medias: [], sections: [], faq: [] };

const toLocalInput = (iso: string) => (iso ? new Date(iso).toISOString().slice(0, 16) : "");

/**
 * Éditeur de la page éditoriale d'un événement : le document MongoDB
 * (event_pages) est remplacé d'un bloc par PUT /events/:id/page.
 */
export function OrganizerEventPagePage({ id }: { id: number }) {
  const { navigate } = useRouter();
  const { toast } = useStore();
  const queryClient = useQueryClient();
  const current = useQuery({ queryKey: keys.eventPage(id, "manage"), queryFn: () => api.eventPage(id, "manage") });
  const templates = useQuery({ queryKey: ["templates", "events"], queryFn: () => api.eventTemplates() });
  const [form, setForm] = useState<EventPageInput>(EMPTY);
  const [tags, setTags] = useState("");

  useEffect(() => {
    if (!current.data) return;
    const { page } = current.data;
    setForm({ templateId: page.templateId, tags: page.tags, programme: page.programme, medias: page.medias, sections: page.sections, faq: page.faq });
    setTags(page.tags.join(", "));
  }, [current.data]);

  const save = useMutation({
    mutationFn: () =>
      api.saveEventPage(id, {
        ...form,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        programme: form.programme.map((p) => ({ ...p, heure: new Date(p.heure).toISOString() })),
      }),
    onSuccess: () => {
      toast("Page enregistrée dans MongoDB", "success");
      void queryClient.invalidateQueries({ queryKey: ["event-page"] });
      void queryClient.invalidateQueries({ queryKey: ["event"] });
    },
    onError: (error) => toast(errorMessage(error), "error"),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteEventPage(id),
    onSuccess: () => {
      toast("Page supprimée : contenu par défaut rétabli", "success");
      void queryClient.invalidateQueries({ queryKey: ["event-page"] });
    },
    onError: (error) => toast(errorMessage(error), "error"),
  });

  const update = <K extends keyof EventPageInput>(key: K, value: EventPageInput[K]) => setForm({ ...form, [key]: value });
  const updateAt = <T,>(list: T[], i: number, patch: Partial<T>) => list.map((item, j) => (j === i ? { ...item, ...patch } : item));
  const removeAt = <T,>(list: T[], i: number) => list.filter((_, j) => j !== i);

  if (current.isError) return <ErrorState onRetry={() => void current.refetch()} />;
  if (!current.data) return <Skeleton className="m-10 h-64" />;
  const event = current.data.evenement;

  return (
    <>
      <DashboardShell
        title={`Page : ${event.nom}`}
        subtitle={current.data.personnalisee ? "Page personnalisée (document MongoDB)" : "Aucune page rédigée : contenu du template par défaut"}
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate(`/events/${event.slug}?scope=manage`)}>
              Voir l'événement
            </Button>
            {current.data.personnalisee && (
              <Button variant="outline" onClick={() => remove.mutate()} disabled={remove.isPending}>
                Supprimer la page
              </Button>
            )}
            <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="page-save">
              Enregistrer
            </Button>
          </div>
        }
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="space-y-4 p-5">
            <FormField label="Template visuel" htmlFor="templateId">
              <Select id="templateId" value={form.templateId} onChange={(e) => update("templateId", e.target.value)}>
                {(templates.data ?? []).map((t: EventTemplate) => (
                  <option key={t.templateId} value={t.templateId}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Tags (séparés par des virgules)" htmlFor="tags" hint="Index MongoDB sur le tableau tags">
              <Input id="tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="plein-air, famille" />
            </FormField>

            <div>
              <div className="flex items-center justify-between">
                <h3 className="font-display font-bold">Programme</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => update("programme", [...form.programme, { heure: event.debut, titre: "", scene: "", artiste: "", dureeMin: 45 } as ProgrammeItem])}
                  data-testid="programme-add"
                >
                  + Créneau
                </Button>
              </div>
              <div className="mt-2 space-y-2">
                {form.programme.map((p, i) => (
                  <div key={i} className="grid gap-2 rounded-[10px] border border-border p-3 sm:grid-cols-[150px_1fr_1fr_80px_auto]">
                    <Input type="datetime-local" value={toLocalInput(p.heure)} onChange={(e) => update("programme", updateAt(form.programme, i, { heure: e.target.value }))} aria-label="Heure" />
                    <Input value={p.titre} onChange={(e) => update("programme", updateAt(form.programme, i, { titre: e.target.value }))} placeholder="Titre" aria-label="Titre" data-testid={`programme-titre-${i}`} />
                    <Input value={p.artiste ?? ""} onChange={(e) => update("programme", updateAt(form.programme, i, { artiste: e.target.value }))} placeholder="Artiste / intervenant" aria-label="Artiste" />
                    <Input type="number" min={1} value={p.dureeMin ?? ""} onChange={(e) => update("programme", updateAt(form.programme, i, { dureeMin: Number(e.target.value) || undefined }))} placeholder="min" aria-label="Durée" />
                    <Button variant="ghost" size="sm" onClick={() => update("programme", removeAt(form.programme, i))} aria-label="Retirer">
                      ✕
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <h3 className="font-display font-bold">Médias</h3>
                <Button variant="ghost" size="sm" onClick={() => update("medias", [...form.medias, { type: "image", url: "", legende: "" } as MediaItem])}>
                  + Média
                </Button>
              </div>
              <div className="mt-2 space-y-2">
                {form.medias.map((m, i) => (
                  <div key={i} className="grid gap-2 rounded-[10px] border border-border p-3 sm:grid-cols-[110px_1fr_1fr_auto]">
                    <Select value={m.type} onChange={(e) => update("medias", updateAt(form.medias, i, { type: e.target.value as MediaItem["type"] }))} aria-label="Type">
                      <option value="image">Image</option>
                      <option value="video">Vidéo</option>
                      <option value="audio">Audio</option>
                    </Select>
                    <Input value={m.url} onChange={(e) => update("medias", updateAt(form.medias, i, { url: e.target.value }))} placeholder="https://…" aria-label="URL" />
                    <Input value={m.legende ?? ""} onChange={(e) => update("medias", updateAt(form.medias, i, { legende: e.target.value }))} placeholder="Légende" aria-label="Légende" />
                    <Button variant="ghost" size="sm" onClick={() => update("medias", removeAt(form.medias, i))} aria-label="Retirer">
                      ✕
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card className="space-y-4 p-5">
            <div>
              <div className="flex items-center justify-between">
                <h3 className="font-display font-bold">Sections</h3>
                <Button variant="ghost" size="sm" onClick={() => update("sections", [...form.sections, { title: "", content: "" }])}>
                  + Section
                </Button>
              </div>
              <div className="mt-2 space-y-2">
                {form.sections.map((s, i) => (
                  <div key={i} className="space-y-2 rounded-[10px] border border-border p-3">
                    <div className="flex gap-2">
                      <Input value={s.title} onChange={(e) => update("sections", updateAt(form.sections, i, { title: e.target.value }))} placeholder="Titre" aria-label="Titre de section" />
                      <Button variant="ghost" size="sm" onClick={() => update("sections", removeAt(form.sections, i))} aria-label="Retirer">
                        ✕
                      </Button>
                    </div>
                    <textarea
                      value={s.content}
                      onChange={(e) => update("sections", updateAt(form.sections, i, { content: e.target.value }))}
                      rows={3}
                      placeholder="Contenu"
                      className="w-full rounded-[10px] border border-border bg-background px-3 py-2 text-sm"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <h3 className="font-display font-bold">FAQ</h3>
                <Button variant="ghost" size="sm" onClick={() => update("faq", [...form.faq, { question: "", answer: "" }])}>
                  + Question
                </Button>
              </div>
              <div className="mt-2 space-y-2">
                {form.faq.map((f, i) => (
                  <div key={i} className="space-y-2 rounded-[10px] border border-border p-3">
                    <div className="flex gap-2">
                      <Input value={f.question} onChange={(e) => update("faq", updateAt(form.faq, i, { question: e.target.value }))} placeholder="Question" aria-label="Question" />
                      <Button variant="ghost" size="sm" onClick={() => update("faq", removeAt(form.faq, i))} aria-label="Retirer">
                        ✕
                      </Button>
                    </div>
                    <textarea
                      value={f.answer}
                      onChange={(e) => update("faq", updateAt(form.faq, i, { answer: e.target.value }))}
                      rows={2}
                      placeholder="Réponse"
                      className="w-full rounded-[10px] border border-border bg-background px-3 py-2 text-sm"
                    />
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>
      </DashboardShell>
      <Footer />
    </>
  );
}
