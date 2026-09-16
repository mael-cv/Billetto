import { IconMinus, IconPlus } from "./icons";

export function QuantitySelector({
  value,
  onChange,
  min = 0,
  max = 10,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-[11px] border border-border bg-background p-1">
      <button
        type="button"
        aria-label="Retirer"
        disabled={disabled || value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
        className="flex size-8 items-center justify-center rounded-[8px] text-foreground transition-colors hover:bg-elevated disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <IconMinus className="size-4" />
      </button>
      <span className="w-7 text-center font-mono text-sm font-semibold tabular-nums" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        aria-label="Ajouter"
        disabled={disabled || value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
        className="flex size-8 items-center justify-center rounded-[8px] text-foreground transition-colors hover:bg-elevated disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <IconPlus className="size-4" />
      </button>
    </div>
  );
}
