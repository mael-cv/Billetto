export const DEFAULT_EVENT_TEMPLATES = [
  {
    templateId: 'festival',
    name: 'Template Festival Open-Air',
    description: 'Design immersif pour festivals en plein air avec gestion du cashless, camping et scènes multiples.',
    theme: {
      primaryColor: '#10b981',
      accentColor: '#f59e0b',
      badgeText: 'FESTIVAL OPEN-AIR',
      heroLayout: 'festival',
      bannerGradient: 'linear-gradient(135deg, rgba(16,185,129,0.2) 0%, rgba(245,158,11,0.25) 100%)',
    },
    highlights: [
      'Plusieurs scènes en simultané',
      'Paiement 100 % Cashless sur place',
      'Espace Camping & Chill-out sécurisé',
      'Navettes gratuites depuis la gare',
    ],
    sections: [
      {
        title: 'Accès & Transports',
        icon: 'bus',
        content:
          'Des navettes de bus dédiées circulent toutes les 15 minutes entre la gare centrale et l’entrée du festival. Un parking surveillé de 2 000 places est également disponible.',
      },
      {
        title: 'Système Cashless & Restauration',
        icon: 'credit-card',
        content:
          'Tous les stands (nourriture, boissons, merchandising) fonctionnent exclusivement avec le bracelet cashless Billetto. Rechargez votre compte en ligne à l’avance ou sur place aux bornes dédiées.',
      },
      {
        title: 'Consignes de sécurité & Objets interdits',
        icon: 'shield',
        content:
          'Bouteilles en verre, feux de détresse et objets tranchants sont formellement interdits. Des fouilles systématiques sont organisées aux points de contrôle d’accès.',
      },
    ],
    faq: [
      {
        question: 'Comment récupérer mon bracelet cashless ?',
        answer: 'Présentez simplement le QR code de votre billet au guichet d’échange à l’entrée pour recevoir votre bracelet préchargé.',
      },
      {
        question: 'Le festival est-il accessible aux personnes à mobilité réduite ?',
        answer: 'Oui, des plateformes surélevées et un cheminement adapté sont prévus devant chaque scène principale.',
      },
    ],
    ticketTemplateId: 'ticket-festival',
    updatedAt: new Date(),
  },
  {
    templateId: 'concert',
    name: 'Template Concert & Scène Live',
    description: 'Ambiance visuelle énergique pour concerts rock, électro, pop et musiques actuelles.',
    theme: {
      primaryColor: '#ec4899',
      accentColor: '#8b5cf6',
      badgeText: 'CONCERT LIVE',
      heroLayout: 'concert',
      bannerGradient: 'linear-gradient(135deg, rgba(236,72,153,0.2) 0%, rgba(139,92,246,0.25) 100%)',
    },
    highlights: [
      'Système sonore haute fidélité L-Acoustics',
      'Vestiaire surveillé sur place (2 €)',
      'Bar & Food court ouverts dès 18h30',
      'Première partie assurée',
    ],
    sections: [
      {
        title: 'Horaires & Déroulé',
        icon: 'clock',
        content:
          'Ouverture des portes à 18h30. Début de la première partie à 19h45. Début du concert principal à 21h00. Fin prévue vers 23h30.',
      },
      {
        title: 'Placement en salle',
        icon: 'map-pin',
        content:
          'Fosse debout libre. Pour les billets en gradins, merci de respecter scrupuleusement le numéro de rangée et de siège indiqué.',
      },
    ],
    faq: [
      {
        question: 'Puis-je sortir et rentrer à nouveau dans la salle ?',
        answer: 'Toute sortie de l’enceinte après validation du billet est définitive.',
      },
      {
        question: 'Les appareils photos professionnels sont-ils autorisés ?',
        answer: 'Seuls les smartphones sont autorisés. Les appareils reflex à objectif interchangeable sont réservés aux photographes accrédités.',
      },
    ],
    ticketTemplateId: 'ticket-concert',
    updatedAt: new Date(),
  },
  {
    templateId: 'conference',
    name: 'Template Conférence & Masterclass Tech',
    description: 'Format professionnel et épuré pour conférences tech, séminaires de bases de données et keynotes.',
    theme: {
      primaryColor: '#06b6d4',
      accentColor: '#6366f1',
      badgeText: 'KEYNOTE & TECH CONF',
      heroLayout: 'conference',
      bannerGradient: 'linear-gradient(135deg, rgba(6,182,212,0.2) 0%, rgba(99,102,241,0.25) 100%)',
    },
    highlights: [
      'Accès à l’ensemble des tracks et workshops',
      'Replay vidéo 4K inclus pour les participants',
      'Buffet déjeunatoire et pauses café inclus',
      'Session de networking avec les speakers',
    ],
    sections: [
      {
        title: 'Badge & Enregistrement',
        icon: 'id-badge',
        content:
          'L’enregistrement ouvre à 08h00 dans le hall principal. Présentez votre QR code sur smartphone pour imprimer instantanément votre badge nominatif.',
      },
      {
        title: 'Wi-Fi & Prises électriques',
        icon: 'wifi',
        content:
          'Un réseau Wi-Fi 6 dédié haut débit sans fil ainsi que des prises de recharge sont disponibles à chaque siège de l’auditorium.',
      },
    ],
    faq: [
      {
        question: 'Les présentations seront-elles partagées après l’événement ?',
        answer: 'Oui, tous les slides des intervenants et les vidéos des talks seront envoyés par email sous 48h.',
      },
    ],
    ticketTemplateId: 'ticket-conference',
    updatedAt: new Date(),
  },
  {
    templateId: 'theatre',
    name: 'Template Théâtre, Danse & Spectacle',
    description: 'Ambiance feutrée et élégante pour représentations théâtrales, ballets et opéras.',
    theme: {
      primaryColor: '#a855f7',
      accentColor: '#eab308',
      badgeText: 'SPECTACLE VIVANT',
      heroLayout: 'theatre',
      bannerGradient: 'linear-gradient(135deg, rgba(168,85,247,0.2) 0%, rgba(234,179,8,0.25) 100%)',
    },
    highlights: [
      'Placement numéroté en salle',
      'Programme imprimé offert aux spectateurs',
      'Entracte de 20 minutes avec service bar au foyer',
    ],
    sections: [
      {
        title: 'Ponctualité stricte',
        icon: 'bell',
        content:
          'Les portes de la salle ferment dès le début de la représentation. Par respect pour les artistes et le public, aucun retardataire ne pourra accéder à sa place une fois le spectacle commencé.',
      },
    ],
    faq: [
      {
        question: 'Existe-t-il un vestiaire obligatoire ?',
        answer: 'Les manteaux volumineux et grands sacs doivent obligatoirement être déposés au vestiaire gratuit.',
      },
    ],
    ticketTemplateId: 'ticket-standard',
    updatedAt: new Date(),
  },
  {
    templateId: 'default',
    name: 'Template Standard Billetto',
    description: 'Template par défaut adaptable à tout type d’événement.',
    theme: {
      primaryColor: '#6366f1',
      accentColor: '#3b82f6',
      badgeText: 'ÉVÉNEMENT OFFICIEL',
      heroLayout: 'standard',
      bannerGradient: 'linear-gradient(135deg, rgba(99,102,241,0.2) 0%, rgba(59,130,246,0.25) 100%)',
    },
    highlights: ['Billetterie 100 % sécurisée', 'E-billet direct avec QR code', 'Support 7j/7'],
    sections: [
      {
        title: 'Informations pratiques',
        icon: 'info',
        content:
          'Présentez votre billet électronique téléchargé sur votre smartphone ou imprimé sur papier blanc A4 le jour de l’événement.',
      },
    ],
    faq: [
      {
        question: 'Comment contacter l’organisateur ?',
        answer: 'Vous pouvez joindre l’organisateur directement via les coordonnées figurant sur la page de l’événement.',
      },
    ],
    ticketTemplateId: 'ticket-standard',
    updatedAt: new Date(),
  },
];

export const DEFAULT_TICKET_TEMPLATES = [
  {
    templateId: 'ticket-festival',
    name: 'Billet Festival Open-Air (Pass Multi-Jours)',
    headerTitle: 'BILLET OFFICIEL · BILLETTO FESTIVAL ACCESS',
    securityWatermark: 'OFFICIAL FESTIVAL PASS · VERIFIED ENTRY · CASHLESS ENABLED',
    instructions:
      'Ce titre d’accès strictement personnel doit être présenté à l’accueil général pour échange contre le bracelet officiel du festival.',
    terms:
      'Toute sortie de l’enceinte du festival est régie par les conditions générales de vente. Revente interdite sous peine de poursuites (loi n° 2012-348).',
    style: {
      cardBg: '#064e3b',
      cardTextColor: '#ecfdf5',
      borderColor: '#10b981',
      accentColor: '#f59e0b',
      badgeBg: 'rgba(16, 185, 129, 0.25)',
      badgeTextColor: '#34d399',
      watermarkOpacity: 0.12,
    },
    badges: ['PASS FESTIVAL', 'CASHLESS INCLUS', 'COUPE-FILE'],
    updatedAt: new Date(),
  },
  {
    templateId: 'ticket-concert',
    name: 'Billet Concert Live',
    headerTitle: 'BILLET OFFICIEL · CONCERT LIVE EXPERIENCE',
    securityWatermark: 'GENUINE BILLETTO TICKET · ANTI-COUNTERFEIT HOLOGRAM ACTIVE',
    instructions:
      'Conservez ce billet avec vous durant toute la durée du concert. Présentation obligatoire au contrôle d’accès.',
    terms:
      'Les organisateurs déclinent toute responsabilité en cas de perte ou de vol. Port de protections auditives fortement recommandé.',
    style: {
      cardBg: '#1e1b4b',
      cardTextColor: '#fdf2f8',
      borderColor: '#ec4899',
      accentColor: '#a855f7',
      badgeBg: 'rgba(236, 72, 153, 0.25)',
      badgeTextColor: '#f472b6',
      watermarkOpacity: 0.14,
    },
    badges: ['LIVE ARENA', 'ACCÈS FOSSE', 'CONTRÔLE SÉCURISÉ'],
    updatedAt: new Date(),
  },
  {
    templateId: 'ticket-vip',
    name: 'Billet Prestige & Carré Or VIP',
    headerTitle: 'BILLET PRIVILÈGE · ACCÈS VIP PREMIUM',
    securityWatermark: 'VIP PRESTIGE ACCESS · EXCLUSIVE LOUNGE PRIVILEGE · BILLETTO LUXURY',
    instructions:
      'Accès réservé par l’entrée VIP dédiée. Accueil personnalisé et vestiaire prioritaire inclus.',
    terms:
      'Ce titre confère un accès exclusif aux salons privatifs et cocktails réservés. Document infalsifiable à conserver.',
    style: {
      cardBg: '#18181b',
      cardTextColor: '#fef08a',
      borderColor: '#eab308',
      accentColor: '#facc15',
      badgeBg: 'rgba(234, 179, 8, 0.2)',
      badgeTextColor: '#fde047',
      watermarkOpacity: 0.18,
    },
    badges: ['CARRE OR VIP', 'COUPE-FILE PRIORITAIRE', 'ACCÈS SALON'],
    updatedAt: new Date(),
  },
  {
    templateId: 'ticket-conference',
    name: 'Badge Délégué Conférence Tech',
    headerTitle: 'BADGE DÉLÉGUÉ · BILLETTO TECH CONFERENCE',
    securityWatermark: 'TECH SUMMIT CREDENTIAL · DELEGATE BADGE · FULL ACCESS',
    instructions:
      'Présentez ce QR code à la borne d’accueil pour obtenir votre badge imprimé tour de cou.',
    terms:
      'Donne droit à l’ensemble des conférences, keynotes, buffet déjeunatoire et à la plateforme de replay vidéo.',
    style: {
      cardBg: '#082f49',
      cardTextColor: '#f0f9ff',
      borderColor: '#0284c7',
      accentColor: '#38bdf8',
      badgeBg: 'rgba(56, 189, 248, 0.2)',
      badgeTextColor: '#7dd3fc',
      watermarkOpacity: 0.12,
    },
    badges: ['ALL ACCESS', 'WORKSHOPS', 'CATERING INCLUS'],
    updatedAt: new Date(),
  },
  {
    templateId: 'ticket-standard',
    name: 'Billet Standard Billetto',
    headerTitle: 'BILLET OFFICIEL · BILLETTO ÉVÉNEMENT',
    securityWatermark: 'BILLETTO VERIFIED · SECURE ENTRY · ELECTRONIC TICKET',
    instructions:
      'Présentez ce billet sur smartphone ou imprimé sur papier A4. Le code-barres / QR code doit être parfaitement lisible.',
    terms:
      'Billet non remboursable sauf annulation de l’événement par l’organisateur ou annulation dans les délais autorisés.',
    style: {
      cardBg: '#18181b',
      cardTextColor: '#f4f4f5',
      borderColor: '#3f3f46',
      accentColor: '#6366f1',
      badgeBg: 'rgba(99, 102, 241, 0.2)',
      badgeTextColor: '#a5b4fc',
      watermarkOpacity: 0.1,
    },
    badges: ['BILLET STANDARD', 'ENTRÉE GÉNÉRALE'],
    updatedAt: new Date(),
  },
];
