import { useEffect, useRef, useState } from "react";
import { IconClock } from "./icons";

function remainingMs(expireA: string): number {
  return new Date(expireA).getTime() - Date.now();
}

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Compte à rebours purement indicatif : l'expiration réelle du hold est
 * vérifiée côté serveur par confirmer_reservation (BT033 si expire_a est
 * dépassé), indépendamment de ce que croit le client.
 */
export function HoldCountdown({ expireA, onExpire }: { expireA: string; onExpire?: () => void }) {
  const [remaining, setRemaining] = useState(() => remainingMs(expireA));
  const expired = useRef(false);

  useEffect(() => {
    expired.current = false;
    const tick = () => {
      const ms = remainingMs(expireA);
      setRemaining(ms);
      if (ms <= 0 && !expired.current) {
        expired.current = true;
        onExpire?.();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expireA, onExpire]);

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground" role="timer" aria-live="polite">
      <IconClock className="size-4 shrink-0" />
      <span>
        Réservation valable encore <span className="font-mono font-semibold tabular-nums text-foreground">{formatRemaining(remaining)}</span>
      </span>
    </div>
  );
}
