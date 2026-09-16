import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { useRouter } from "../lib/router";

// ---------- Link ----------
export function Link({
  to,
  children,
  className = "",
  onClick,
}: {
  to: string;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  const { navigate } = useRouter();
  return (
    <a
      href={"#" + to}
      className={className}
      onClick={(e) => {
        e.preventDefault();
        onClick?.();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

// ---------- Button ----------
type Variant = "primary" | "secondary" | "ghost" | "outline" | "danger";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary:
    "bg-primary text-primary-foreground hover:brightness-95 active:brightness-90 shadow-[0_1px_0_rgba(255,255,255,0.15)_inset]",
  secondary: "bg-elevated text-foreground hover:bg-[#232328] border border-border",
  ghost: "text-foreground hover:bg-elevated",
  outline: "border border-border-strong text-foreground hover:bg-elevated",
  danger: "bg-danger/15 text-danger hover:bg-danger/25 border border-danger/30",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-3.5 text-sm rounded-[10px] gap-1.5",
  md: "h-11 px-5 text-sm rounded-[12px] gap-2",
  lg: "h-13 px-7 text-base rounded-[14px] gap-2",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  loading,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <button
      className={`inline-flex items-center justify-center font-medium transition-all duration-150 disabled:opacity-45 disabled:pointer-events-none ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

export function Spinner({ className = "size-5" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

// ---------- Badge ----------
export function Badge({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "success" | "warning" | "danger" | "muted";
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "bg-elevated text-foreground border-border",
    accent: "bg-primary/15 text-primary border-primary/25",
    success: "bg-success/12 text-success border-success/25",
    warning: "bg-warning/12 text-warning border-warning/25",
    danger: "bg-danger/12 text-danger border-danger/25",
    muted: "bg-transparent text-muted-foreground border-border",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium font-mono uppercase tracking-wide ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

// ---------- Card ----------
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[16px] border border-border bg-card ${className}`}>{children}</div>;
}

// ---------- Field ----------
export function FormField({
  label,
  error,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {children}
      {error ? (
        <span className="text-xs text-danger flex items-center gap-1" role="alert">
          <svg viewBox="0 0 16 16" className="size-3.5" fill="currentColor" aria-hidden>
            <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm-.75 3.5h1.5v5h-1.5v-5zM8 12.25a1 1 0 110-2 1 1 0 010 2z" />
          </svg>
          {error}
        </span>
      ) : hint ? (
        <span className="text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  );
}

export function Input({ className = "", invalid, ...props }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      className={`h-11 rounded-[12px] border bg-background px-3.5 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary/60 ${
        invalid ? "border-danger/60" : "border-border"
      } ${className}`}
      {...props}
    />
  );
}

export function Select({ className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        className={`h-11 w-full appearance-none rounded-[12px] border border-border bg-background px-3.5 pr-9 text-sm text-foreground transition-colors focus:border-primary/60 ${className}`}
        {...props}
      >
        {children}
      </select>
      <svg className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

// ---------- States ----------
export function EmptyState({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[16px] border border-dashed border-border py-20 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-elevated">
        <svg viewBox="0 0 24 24" className="size-6 text-muted-foreground" fill="none" aria-hidden>
          <path d="M3 7l9-4 9 4-9 4-9-4zm0 5l9 4 9-4M3 17l9 4 9-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{message}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[16px] border border-danger/20 bg-danger/5 py-20 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-danger/15 text-danger">
        <svg viewBox="0 0 24 24" className="size-6" fill="none" aria-hidden>
          <path d="M12 8v5m0 3h.01M10.3 3.9L2.4 18a2 2 0 001.7 3h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h3 className="font-display text-lg font-semibold">Une erreur est survenue</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">Impossible de charger les données. Vérifiez votre connexion et réessayez.</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-5" onClick={onRetry}>
          Réessayer
        </Button>
      )}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-[10px] ${className}`} />;
}

// ---------- Tabs ----------
export function Tabs({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: string; label: string; count?: number }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div role="tablist" className="inline-flex gap-1 rounded-[12px] border border-border bg-card p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={`rounded-[9px] px-3.5 py-1.5 text-sm font-medium transition-colors ${
            value === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t.label}
          {typeof t.count === "number" && <span className="ml-1.5 opacity-60">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
