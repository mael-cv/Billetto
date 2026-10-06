# @billetto/security-audit

Moteur d'audit de sécurité de Billetto : pentest black-box local + audit white-box du dépôt +
infra/supply-chain + corrélation + reporting (JSON/Markdown/HTML). TypeScript via `tsx`, sans build.
**Fonctionne sans aucune clé API LLM.**

```bash
# aide
pnpm --filter @billetto/security-audit exec tsx src/cli.ts --help

# pentest black-box de l'app locale (doit être démarrée, ou configurer lifecycle.start_command)
pnpm --filter @billetto/security-audit pentest          # standard
pnpm --filter @billetto/security-audit pentest:full     # toutes catégories

# audit white-box du dépôt (sans app)
pnpm --filter @billetto/security-audit whitebox

# audit complet + rapports + AI package
pnpm --filter @billetto/security-audit exec tsx src/cli.ts --full --ai-package

# rejouer un finding
pnpm --filter @billetto/security-audit exec tsx src/cli.ts --retest SEC-001

# tests du moteur (unitaires + acceptance contre la fixture vulnérable)
pnpm --filter @billetto/security-audit test
```

Rapports générés dans `doc/security-audit/` : `security-report.{json,md,html}`.

Documentation complète : [`doc/security-audit.md`](../../doc/security-audit.md).

Sûreté : cible restreinte à `localhost`/`127.0.0.1`/`::1` (configurable), requêtes bornées, pas de
DoS, pas de payload destructif, comptes de démo uniquement. Voir `security-audit.yaml`.
