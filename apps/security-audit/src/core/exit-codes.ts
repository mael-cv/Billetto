/** Codes de sortie distincts : découverte de vuln ≠ crash du scanner. */
export const ExitCode = {
  SUCCESS: 0, // audit terminé, gate passé
  GATE_FAILED: 1, // des findings dépassent le security_gate
  SCANNER_ERROR: 2, // erreur interne / scanner externe en échec
  CONFIG_ERROR: 3, // configuration ou cible invalide
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

/** Erreur typée pour sortir proprement avec un code précis. */
export class AuditError extends Error {
  constructor(
    message: string,
    readonly code: ExitCodeValue,
  ) {
    super(message);
    this.name = "AuditError";
  }
}
