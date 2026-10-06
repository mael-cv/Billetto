import type { OrderEmailData, RenderedEmail, WaitlistEmailData } from './email';

// Contenu des e-mails : fonctions pures, sans I/O (testées unitairement).
// Les heures sont affichées dans le fuseau de l'événement, avec son nom :
// l'e-mail est lu hors de l'application, sans conversion possible côté client.

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function formatInZone(iso: string, timeZone: string): string {
  const date = new Date(iso);
  const text = new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone,
  }).format(date);
  const zone = new Intl.DateTimeFormat('fr-FR', { timeZone, timeZoneName: 'long' })
    .formatToParts(date)
    .find((p) => p.type === 'timeZoneName')?.value;
  return zone ? `${text} (${zone})` : text;
}

const euros = (v: string | number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(v));

export function renderOrderConfirmation(prenom: string, data: OrderEmailData, webUrl: string): RenderedEmail {
  const first = data.billets[0];
  const evenement = first?.evenement ?? 'votre événement';
  const where = first ? (first.enLigne ? 'En ligne' : `${first.lieu}, ${first.ville}`) : '';
  const when = first ? formatInZone(first.debut, first.fuseauHoraire) : '';
  const n = data.billets.length;

  const text = [
    `Bonjour ${prenom},`,
    '',
    `Votre commande n° ${data.commandeId} est confirmée (${euros(data.montantTotal)}).`,
    `${evenement} — ${when}${where ? ` — ${where}` : ''}`,
    '',
    `${n} billet${n > 1 ? 's' : ''} :`,
    ...data.billets.map((b) => `  - ${b.tarif} (${euros(b.prix)}) — code ${b.code}`),
    '',
    'Les QR codes sont joints à cet e-mail ; présentez-les à l’entrée.',
    `Retrouvez vos billets : ${webUrl}/tickets`,
  ].join('\n');

  const html = `
<p>Bonjour ${escapeHtml(prenom)},</p>
<p>Votre commande n° ${data.commandeId} est confirmée (${escapeHtml(euros(data.montantTotal))}).</p>
<p><strong>${escapeHtml(evenement)}</strong><br>${escapeHtml(when)}${where ? `<br>${escapeHtml(where)}` : ''}</p>
${data.billets
  .map(
    (b) => `<div style="margin:16px 0">
  <img src="cid:qr-${b.billetId}" alt="QR du billet ${escapeHtml(b.code)}" width="180" height="180"><br>
  ${escapeHtml(b.tarif)} — ${escapeHtml(euros(b.prix))}<br><code>${escapeHtml(b.code)}</code>
</div>`,
  )
  .join('\n')}
<p><a href="${escapeHtml(webUrl)}/tickets">Voir mes billets</a></p>`;

  return {
    subject: `Vos billets — ${evenement}`,
    text,
    html,
    qrAttachments: data.billets.map((b) => ({
      cid: `qr-${b.billetId}`,
      filename: `billet-${b.billetId}.png`,
      payload: b.qrPayload,
    })),
  };
}

export function renderWaitlistOffer(prenom: string, data: WaitlistEmailData, webUrl: string): RenderedEmail {
  const when = formatInZone(data.debut, data.fuseauHoraire);
  const deadline = formatInZone(data.expireA, data.fuseauHoraire);
  const places = `${data.quantite} place${data.quantite > 1 ? 's' : ''}`;
  const text = [
    `Bonjour ${prenom},`,
    '',
    `Bonne nouvelle : ${places} « ${data.tarif} » se sont libérées pour ${data.evenement} (${when}).`,
    `Elles vous sont réservées jusqu’au ${deadline}.`,
    `Confirmez avant cette date : ${webUrl}/waitlist`,
    '',
    'Sans réponse de votre part, elles seront proposées à la personne suivante.',
  ].join('\n');
  const html = `
<p>Bonjour ${escapeHtml(prenom)},</p>
<p>Bonne nouvelle : ${places} « ${escapeHtml(data.tarif)} » se sont libérées pour
<strong>${escapeHtml(data.evenement)}</strong> (${escapeHtml(when)}).</p>
<p>Elles vous sont réservées jusqu’au <strong>${escapeHtml(deadline)}</strong>.</p>
<p><a href="${escapeHtml(webUrl)}/waitlist">Confirmer ma place</a></p>
<p>Sans réponse de votre part, elles seront proposées à la personne suivante.</p>`;
  return { subject: `Une place vous attend — ${data.evenement}`, text, html, qrAttachments: [] };
}
