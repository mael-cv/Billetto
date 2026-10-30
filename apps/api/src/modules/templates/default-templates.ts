import type { EventTemplateDocument, TicketTemplateDocument } from '../../common/mongodb/templates.types';
// @ts-expect-error - importation directe depuis le fichier source ESM commun
import { DEFAULT_EVENT_TEMPLATES as rawEvents, DEFAULT_TICKET_TEMPLATES as rawTickets } from '../../../../../database/seed/default-templates.mjs';

export const DEFAULT_EVENT_TEMPLATES: Omit<EventTemplateDocument, '_id'>[] = rawEvents as unknown as Omit<EventTemplateDocument, '_id'>[];
export const DEFAULT_TICKET_TEMPLATES: Omit<TicketTemplateDocument, '_id'>[] = rawTickets as unknown as Omit<TicketTemplateDocument, '_id'>[];
