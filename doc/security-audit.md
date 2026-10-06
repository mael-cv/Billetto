# Plateforme `security-audit`

Moteur d'audit de sécurité interne de Billetto : **pentest black-box** (application réellement démarrée) + **audit white-box** (dépôt) + **infra/supply-chain** + **corrélation** + **reporting**. Package : `apps/security-audit` (TypeScript, exécuté via `tsx`, sans build). Fonctionne **100 % sans clé API LLM**.

## Installation

Aucune installation spécifique : le package fait partie du workspace pnpm.

```bash
pnpm install
pnpm --filter @billetto/security-audit exec tsx src/cli.ts --help
```

Les scanners open-source (Semgrep, Gitleaks, Trivy, OSV-Scanner) sont **optionnels** : détectés s'ils sont dans le `PATH`, sinon `NOT_INSTALLED` et l'audit continue.

## Architecture

```
CLI → config → target-safety → (lifecycle: detect/auto-start) →
  [ black-box (pentest) ∥ white-box (repo) ∥ infra ] →
  correlation → dedup → honeypots → severity/CVSS → coverage →
  report (JSON/MD/HTML) → security gate → exit code → (AI review package)
```

- **core/** : `target-safety` (allowlist + DNS + redirects sortants bloqués), `http-client` (borné, redirect manuel), `sessions` (CSRF double-submit), `callback-server` (SSRF local), `lifecycle`, `finding`, `score` (CVSS v3.1), `coverage`, `dedup`, `evidence` (redaction), `retest`.
- **discovery/** : routes depuis le code NestJS (`from-code`) + sondage runtime.
- **pentest/** : ~28 checks black-box (un fichier par catégorie).
- **whitebox/** : SAST, secrets, dependencies, configuration, docker, cicd, infrastructure.
- **scanners/** : adaptateurs externes optionnels.
- **correlation/**, **reporting/**, **ai/**, **fixtures/vulnerable-app/**.

## CLI

```bash
security-audit                      # audit complet (white-box + infra ; black-box si cible joignable)
security-audit --pentest [--full]   # pentest black-box (--full = toutes catégories)
security-audit --sast|--secrets|--dependencies|--infra   # moteurs white-box ciblés
security-audit --retest SEC-001     # rejoue un finding -> PASS|FAIL|INCONCLUSIVE
```

Options : `--profile quick|standard|full`, `--format json|md|html|all`, `--base-url`, `--config`,
`--target-start` (auto-start forcé), `--all-files` (secrets incl. gitignorés), `--offline`,
`--ci` (step summary + exit code gate), `--ai-package`, `--concurrency`, `--max-requests`, `-v/-q`.

Scripts : `pnpm --filter @billetto/security-audit pentest` / `pentest:full` / `whitebox` / `test`.

## Configuration

`apps/security-audit/security-audit.yaml` : `target` (base_url, allowed_hosts, proxy_url, routes),
`accounts` (comptes de démo + `password_env`), `lifecycle` (health, start_command), `bruteforce`
(borné), `limits` (concurrence/requêtes/timeouts), `scanners`, `profiles`, `honeypots`,
`security_gate` (fail_on, max_medium), `output.dir`.

**Comptes de test** : uniquement les comptes de démo seedés (`demo-visiteur@`, `demo-organisateur@`,
`demo-admin@billetto.test`, mot de passe `DEMO_PASSWORD`). USER_B est inscrit à chaud via
`/auth/register`. **Jamais de vrais credentials.**

## Sûreté (TARGET SAFETY)

Aucun test actif ne démarre avant validation de la cible : parsing de l'URL, résolution DNS,
vérification de l'allowlist (`localhost`, `127.0.0.1`, `::1` par défaut), refus des IP non locales
(anti DNS-rebinding) et des redirects sortants. Défauts sûrs : concurrence basse, requêtes bornées,
timeouts courts, pas de DoS, pas de payload destructif, brute force borné (`max_attempts`,
`concurrency: 1`, `delay_ms`). Les tests agressifs ne tournent qu'en profil `full`/`--full`.

## Catégories testées

Black-box : discovery, http-methods, middleware, authentication, account-enumeration, bruteforce,
authorization (IDOR/BOLA), privilege-escalation, input-fuzzing, injection, xss, csrf, cors,
security-headers, cookies, session, jwt, error-handling, debug-endpoints, file-upload,
path-traversal, ssrf (callback local), open-redirect, api (mass-assignment), rate-limiting,
resource-exhaustion, http-desync (expérimental), websockets, timing, business-logic, honeypots.

White-box : sast, secrets, dependencies, configuration, docker, cicd, infrastructure.

## Findings, sévérité, couverture

- **Finding** unifié : `id`, `severity`, `confidence`, `status`, `classification`, `category`,
  `cwe`, `owasp`, `cvss`, `source`, `location`, `evidence` (redactée), `reproduction`, `remediation`.
- **Sévérité** : CVSS v3.1 base recalculé localement (jamais la note brute d'un scanner tiers).
  L'absence d'un en-tête n'est jamais HIGH par défaut.
- **Couverture** honnête : `TESTED | NOT_TESTED | NOT_APPLICABLE | INCONCLUSIVE`. Le rapport affiche
  « No confirmed vulnerabilities found among tested controls » + `Coverage: NN%`, jamais
  « 0 vulnerabilities » si un contrôle n'a pas pu tourner.

## Retest

```bash
security-audit --retest SEC-001   # -> PASS (corrigé) | FAIL (toujours vulnérable) | INCONCLUSIVE
```

Le retest relit le dernier run (`doc/security-audit/.last-run.json`) et rejoue le côté pertinent.

## Fixture vulnérable & tests

`apps/security-audit/fixtures/vulnerable-app` est une application volontairement vulnérable
(missing authz, IDOR, weak rate limit, reflected XSS, bad CORS, verbose error, unsafe redirect,
weak cookie, mass assignment, upload, SSRF, + honeypot). Le test d'acceptance
(`test/acceptance/fixture.spec.ts`) lance le moteur contre elle et vérifie que **chaque** vuln est
retrouvée, que le honeypot est classé `INTENTIONAL_HONEYPOT`, et qu'aucun faux positif n'apparaît
sur la route saine. `pnpm --filter @billetto/security-audit test`.

## VS Code

`.vscode/tasks.json` (Quick/Standard/Full/Pentest/White-box/Retest/Generate Report) et
`.vscode/launch.json` (debug `tsx`). Une extension native n'est pas justifiée à ce stade.

## GitHub Actions

`.github/workflows/security-audit.yml` : job `whitebox` (sans app, installe les scanners) + job
`blackbox` (`needs: whitebox`, démarre Postgres + API comme `ci.yml`, puis pentest `--full`).
Permissions minimales, aucun secret requis, rapports publiés en artifacts, résumé dans
`$GITHUB_STEP_SUMMARY`, `security_gate` → code de sortie.

Codes de sortie : `0` succès · `1` gate échoué · `2` erreur scanner · `3` configuration invalide.

## AI-assisted (optionnel, sans clé API)

`--ai-package` génère `doc/security-audit/ai-review/` (`context.md`, `findings.json`,
`source-map.json`, `coverage.json`, `prompts/`) à fournir **manuellement** à Claude Code / Codex /
Mistral (protocole contradictoire Attacker/Defender/Judge). Le cœur n'appelle jamais d'API.

## Étendre

- **Ajouter un check black-box** : créer `src/pentest/<nom>.ts` (interface `BlackboxCheck`) et
  l'enregistrer dans `src/pentest/index.ts`.
- **Ajouter un moteur white-box** : `src/whitebox/<nom>/index.ts` + `src/whitebox/index.ts`.
- **Ajouter un scénario métier** : via `business_logic` dans la config, ou `src/pentest/business-logic/`.
- **Ajouter un honeypot** : `honeypots: [{ method, path }]` dans la config.
- **Ajouter un scanner externe** : adaptateur dans `src/scanners/registry.ts`.

## Dépannage

- *Cible refusée* : la cible n'est pas dans `allowed_hosts` ou résout vers une IP non locale.
- *Black-box NOT_TESTED* : application injoignable (configurer `lifecycle.start_command` ou démarrer
  l'app) ; certaines catégories peuvent être `INCONCLUSIVE` si le rate-limit coupe un test (relancer
  la catégorie isolément).
- *Scanner NOT_INSTALLED* : installer l'outil (Semgrep/Gitleaks/Trivy/OSV) ou ignorer — le cœur reste
  autonome.
