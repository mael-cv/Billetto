import { compareSeverity, type Finding, type Severity } from "../core/finding";
import { realFindings, severityCounts, SEVERITIES, type ReportData } from "./report";

/** Rapport HTML autoportant (CSS inline, aucun CDN). */
export function renderHtml(report: ReportData): string {
  const counts = severityCounts(report.findings);
  const real = realFindings(report.findings).sort((a, b) => compareSeverity(a.severity, b.severity));

  const cards = SEVERITIES.map(
    (s) => `<div class="card ${s.toLowerCase()}"><div class="n">${counts[s]}</div><div class="l">${s}</div></div>`,
  ).join("");

  const coverageRows = report.coverage
    .map((c) => `<tr><td>${esc(c.category)}</td><td class="st ${c.status.toLowerCase()}">${c.status}</td><td>${esc(c.note ?? "")}</td></tr>`)
    .join("");

  const findingsHtml = real.length
    ? real.map(renderFinding).join("\n")
    : `<p class="ok">No confirmed vulnerabilities found among tested controls.</p>`;

  const scanners = report.meta.scanners
    .map((s) => `<li>${esc(s.name)} : ${s.installed ? "disponible" : "NOT_INSTALLED"}</li>`)
    .join("");

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rapport security-audit</title>
<style>
:root{--bg:#0f1221;--panel:#191d33;--fg:#e8eaf2;--muted:#9aa0b5;--line:#2a2f4a;
--crit:#ff4d6d;--high:#ff8a3d;--med:#ffd23d;--low:#4dd4ff;--info:#8b93ad;--ok:#3ddc97;}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,Segoe UI,Roboto,sans-serif}
.wrap{max-width:1000px;margin:0 auto;padding:24px 16px}
h1{font-size:24px;margin:0 0 4px}h2{margin-top:32px;border-bottom:1px solid var(--line);padding-bottom:6px}
.meta{color:var(--muted);font-size:14px}
.cards{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}
.card{flex:1;min-width:110px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px;text-align:center}
.card .n{font-size:28px;font-weight:700}.card .l{color:var(--muted);font-size:12px;letter-spacing:.06em}
.card.critical .n{color:var(--crit)}.card.high .n{color:var(--high)}.card.medium .n{color:var(--med)}.card.low .n{color:var(--low)}.card.info .n{color:var(--info)}
table{width:100%;border-collapse:collapse;margin:8px 0}th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.05em}
.cov{font-size:18px;font-weight:700;color:var(--ok)}
.st.tested{color:var(--ok)}.st.not_applicable{color:var(--muted)}.st.not_tested{color:var(--high)}.st.inconclusive{color:var(--med)}
.f{background:var(--panel);border:1px solid var(--line);border-left-width:4px;border-radius:10px;padding:14px;margin:12px 0}
.f.critical{border-left-color:var(--crit)}.f.high{border-left-color:var(--high)}.f.medium{border-left-color:var(--med)}.f.low{border-left-color:var(--low)}.f.info{border-left-color:var(--info)}
.f h3{margin:0 0 6px;font-size:16px}.tag{display:inline-block;font-size:11px;padding:2px 8px;border-radius:999px;background:var(--line);margin-right:6px}
.ok{color:var(--ok);font-weight:600}.muted{color:var(--muted)}
pre{white-space:pre-wrap;background:#0c0f1d;border:1px solid var(--line);border-radius:8px;padding:10px;font-size:13px;overflow:auto}
ul{margin:6px 0}
</style></head><body><div class="wrap">
<h1>Rapport security-audit</h1>
<p class="meta">Cible ${esc(report.meta.baseUrl)} — ${report.meta.appReachable ? "joignable" : "non joignable"} · profil ${esc(report.meta.profile)} · ${esc(report.meta.timestamp)} · ${report.meta.requestsMade} requêtes</p>
<div class="cards">${cards}</div>
<p class="cov">Couverture : ${report.coveragePercent}%</p>
${real.length === 0 ? '<p class="ok">No confirmed vulnerabilities found among tested controls.</p>' : ""}
<h2>Couverture par catégorie</h2>
<table><thead><tr><th>Catégorie</th><th>Statut</th><th>Note</th></tr></thead><tbody>${coverageRows}</tbody></table>
<h2>Findings</h2>
${findingsHtml}
<h2>Scanners externes</h2><ul>${scanners}</ul>
</div></body></html>`;
}

function renderFinding(f: Finding): string {
  const sev = f.severity.toLowerCase();
  const loc = f.location.endpoint
    ? `${esc(f.location.method ?? "")} ${esc(f.location.endpoint)}`
    : f.location.file
      ? `${esc(f.location.file)}:${f.location.line ?? ""}`
      : "—";
  const repro = f.reproduction.map((r) => `<li>${esc(r)}</li>`).join("");
  return `<div class="f ${sev}">
<h3>${esc(f.id)} — ${esc(f.title)}</h3>
<div><span class="tag">${f.severity}${f.cvss ? ` · CVSS ${f.cvss}` : ""}</span><span class="tag">${f.status}</span><span class="tag">${esc(f.category)}</span><span class="tag">${esc(f.source)}</span>${f.cwe ? `<span class="tag">${esc(f.cwe)}</span>` : ""}</div>
<p class="muted">Localisation : ${loc} · confiance ${(f.confidence * 100).toFixed(0)}%</p>
${f.impact ? `<p><strong>Impact :</strong> ${esc(f.impact)}</p>` : ""}
${f.remediation ? `<p><strong>Remédiation :</strong> ${esc(f.remediation)}</p>` : ""}
${repro ? `<p><strong>Reproduction :</strong></p><ol>${repro}</ol>` : ""}
${f.retestable ? `<pre>security-audit --retest ${esc(f.id)}</pre>` : ""}
</div>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

// (sévérité utilisée pour la classe CSS)
export type { Severity };
