// Consistent line-icon set (1.6 stroke) used across the app.
type P = { className?: string };
const base = "none";

export const IconSearch = ({ className = "size-5" }: P) => (
  <svg className={className} viewBox="0 0 24 24" fill={base} aria-hidden>
    <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.6" />
    <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export const IconPin = ({ className = "size-5" }: P) => (
  <svg className={className} viewBox="0 0 24 24" fill={base} aria-hidden>
    <path d="M12 21s-6.5-5.6-6.5-10.5A6.5 6.5 0 0112 4a6.5 6.5 0 016.5 6.5C18.5 15.4 12 21 12 21z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <circle cx="12" cy="10.5" r="2.3" stroke="currentColor" strokeWidth="1.6" />
  </svg>
);

export const IconCalendar = ({ className = "size-5" }: P) => (
  <svg className={className} viewBox="0 0 24 24" fill={base} aria-hidden>
    <rect x="3.5" y="5" width="17" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
    <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export const IconClock = ({ className = "size-5" }: P) => (
  <svg className={className} viewBox="0 0 24 24" fill={base} aria-hidden>
    <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
    <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconTicket = ({ className = "size-5" }: P) => (
  <svg className={className} viewBox="0 0 24 24" fill={base} aria-hidden>
    <path d="M4 7.5A1.5 1.5 0 015.5 6h13A1.5 1.5 0 0120 7.5V10a2 2 0 000 4v2.5a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 16.5V14a2 2 0 000-4V7.5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M14 6v12" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2 2.5" />
  </svg>
);

export const IconUser = ({ className = "size-5" }: P) => (
  <svg className={className} viewBox="0 0 24 24" fill={base} aria-hidden>
    <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.6" />
    <path d="M4.5 20a7.5 7.5 0 0115 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export const IconCheck = ({ className = "size-5" }: P) => (
  <svg className={className} viewBox="0 0 24 24" fill={base} aria-hidden>
    <path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconArrow = ({ className = "size-5" }: P) => (
  <svg className={className} viewBox="0 0 24 24" fill={base} aria-hidden>
    <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconPlus = ({ className = "size-5" }: P) => (
  <svg className={className} viewBox="0 0 24 24" fill={base} aria-hidden>
    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export const IconMinus = ({ className = "size-5" }: P) => (
  <svg className={className} viewBox="0 0 24 24" fill={base} aria-hidden>
    <path d="M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export const IconFilter = ({ className = "size-5" }: P) => (
  <svg className={className} viewBox="0 0 24 24" fill={base} aria-hidden>
    <path d="M4 6h16M7 12h10M10 18h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export const IconMenu = ({ className = "size-5" }: P) => (
  <svg className={className} viewBox="0 0 24 24" fill={base} aria-hidden>
    <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export const IconClose = ({ className = "size-5" }: P) => (
  <svg className={className} viewBox="0 0 24 24" fill={base} aria-hidden>
    <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export const IconEye = ({ className = "size-5" }: P) => (
  <svg className={className} viewBox="0 0 24 24" fill={base} aria-hidden>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <circle cx="12" cy="12" r="2.8" stroke="currentColor" strokeWidth="1.6" />
  </svg>
);

export const IconEyeOff = ({ className = "size-5" }: P) => (
  <svg className={className} viewBox="0 0 24 24" fill={base} aria-hidden>
    <path d="M4 4l16 16M9.5 9.6a2.8 2.8 0 004 3.9M6.3 6.4C3.9 7.9 2.5 12 2.5 12s3.5 6.5 9.5 6.5c1.6 0 3-.4 4.2-1M15.5 6.2A9.9 9.9 0 0012 5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconChart = ({ className = "size-5" }: P) => (
  <svg className={className} viewBox="0 0 24 24" fill={base} aria-hidden>
    <path d="M4 20V4M4 20h16M8 20v-6M12 20v-9M16 20v-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconShield = ({ className = "size-5" }: P) => (
  <svg className={className} viewBox="0 0 24 24" fill={base} aria-hidden>
    <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconDownload = ({ className = "size-5" }: P) => (
  <svg className={className} viewBox="0 0 24 24" fill={base} aria-hidden>
    <path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
