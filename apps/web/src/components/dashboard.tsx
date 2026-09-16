import type { ReactNode } from "react";
import { Card } from "./ui";

export function StatCard({
  label,
  value,
  delta,
  icon,
}: {
  label: string;
  value: string;
  delta?: { value: string; positive: boolean };
  icon?: ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">{label}</span>
        {icon && <span className="text-muted-foreground">{icon}</span>}
      </div>
      <div className="mt-3 font-display text-3xl font-extrabold tabular-nums">{value}</div>
      {delta && (
        <div className={`mt-1.5 flex items-center gap-1 text-sm ${delta.positive ? "text-success" : "text-danger"}`}>
          <span>{delta.positive ? "↑" : "↓"}</span>
          <span className="tabular-nums">{delta.value}</span>
          <span className="text-muted-foreground">vs. période précédente</span>
        </div>
      )}
    </Card>
  );
}

export function DashboardShell({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-[1240px] px-5 pb-24 pt-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
          {subtitle && <p className="mt-1.5 text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="mt-8">{children}</div>
    </div>
  );
}
