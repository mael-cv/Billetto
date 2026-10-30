export interface EventTemplateTheme {
  primaryColor: string;
  accentColor: string;
  badgeText: string;
  heroLayout: 'festival' | 'concert' | 'conference' | 'theatre' | 'standard';
  bannerGradient: string;
}

export interface EventTemplateSection {
  title: string;
  icon?: string;
  content: string;
}

export interface EventTemplateDocument {
  templateId: string; // ex: 'concert', 'festival', 'conference', 'theatre', 'sport', 'default'
  name: string;
  description?: string;
  theme: EventTemplateTheme;
  highlights: string[];
  sections: EventTemplateSection[];
  faq: Array<{ question: string; answer: string }>;
  ticketTemplateId: string;
  updatedAt: Date;
}

export interface TicketTemplateStyle {
  cardBg: string;
  cardTextColor: string;
  borderColor: string;
  accentColor: string;
  badgeBg: string;
  badgeTextColor: string;
  watermarkOpacity: number;
}

export interface TicketTemplateDocument {
  templateId: string; // ex: 'ticket-standard', 'ticket-vip', 'ticket-festival', 'default'
  name: string;
  headerTitle: string;
  securityWatermark: string;
  instructions: string;
  terms: string;
  style: TicketTemplateStyle;
  badges: string[];
  updatedAt: Date;
}
