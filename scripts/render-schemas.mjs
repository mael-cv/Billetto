// Rend docs/schemas/*.mmd en PNG avec le Chromium de Playwright (déjà installé pour
// les tests du front) et le bundle Mermaid local : aucun accès réseau nécessaire.
//   node scripts/render-schemas.mjs [chemin/vers/mermaid.min.js]
// security-audit-ignore: child-process -- aucune commande externe, uniquement Playwright
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'apps/web/package.json'));
const { chromium } = require('@playwright/test');

const candidates = [
  process.argv[2],
  join(root, 'node_modules/mermaid/dist/mermaid.min.js'),
  join(root, 'apps/web/node_modules/mermaid/dist/mermaid.min.js'),
  join(process.env.LOCALAPPDATA ?? '', 'npm-cache/_npx/668c188756b835f3/node_modules/mermaid/dist/mermaid.min.js'),
].filter(Boolean);
const bundle = candidates.find((p) => existsSync(p));
if (!bundle) {
  console.error('mermaid.min.js introuvable ; passer son chemin en argument (ex. depuis le cache npx de @mermaid-js/mermaid-cli)');
  process.exit(1);
}

const dir = join(root, 'docs/schemas');
const files = readdirSync(dir).filter((f) => f.endsWith('.mmd'));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1800, height: 1200 }, deviceScaleFactor: 2 });
await page.setContent('<!doctype html><html><body style="margin:0;background:#fff"><div id="out"></div></body></html>');
await page.addScriptTag({ content: readFileSync(bundle, 'utf8') });

for (const file of files) {
  const code = readFileSync(join(dir, file), 'utf8');
  await page.evaluate(async (src) => {
    window.mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose', er: { useMaxWidth: false }, flowchart: { useMaxWidth: false } });
    const { svg } = await window.mermaid.render('g' + Date.now(), src);
    document.getElementById('out').innerHTML = svg;
  }, code);
  const svg = page.locator('#out svg');
  const out = join(dir, file.replace(/\.mmd$/, '.png'));
  await svg.screenshot({ path: out });
  console.log(`✓ ${file} → ${out}`);
}
await browser.close();
