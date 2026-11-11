// The counter-proof of the scenarios: each mutation of tools/mutations.json is applied as the code loads
// (vitest.mutations.config.ts), the scenarios are played, and the report must fail on the mutation's own link.
// Fails if a pattern is missing (update the table), a mutation survives, or most failures name another link.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const table = JSON.parse(readFileSync('tools/mutations.json', 'utf8'));
const VITEST = join('node_modules', 'vitest', 'vitest.mjs');
const debut = Date.now();

/** The report's failures: every row of a scenario's table that is neither held nor a known defect that holds. */
const echecs = (md) => {
  const out = [];
  let nom = '';
  for (const l of md.split('\n')) {
    if (l.startsWith('## ')) nom = l.slice(3);
    const c = l.split('|').map((x) => x.trim());
    if (c.length < 8 || c[1] === 'Attendu' || c[1].startsWith('---')) continue;
    if (c[2] === 'tenue' || /^connue \(/.test(c[2])) continue;
    out.push({ nom, id: c[1], espece: c[3], source: c[4].split(' (')[0] });
  }
  return out;
};

const jouer = (k) =>
  new Promise((ok) => {
    const dir = mkdtempSync(join(tmpdir(), `mutation-${k}-`));
    const args = [VITEST, 'run', 'src/presence/scenarios.test.ts', '--config', 'vitest.mutations.config.ts'];
    const p = spawn(process.execPath, [...args, '--mode', 'scenarios'], {
      env: { ...process.env, MUTATION: k, BANC_DIR: dir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let sortie = '';
    p.stdout.on('data', (d) => (sortie += d));
    p.stderr.on('data', (d) => (sortie += d));
    p.on('close', () => {
      const f = join(dir, 'scenarios', 'releve-scenarios.md');
      const md = existsSync(f) ? readFileSync(f, 'utf8') : undefined;
      rmSync(dir, { recursive: true, force: true });
      if (md === undefined) console.error(`--- ${k} : sortie de vitest ---\n${sortie}`);
      ok(md);
    });
  });

const juger = async (k, m) => {
  const n = readFileSync(m.fichier, 'utf8').split(m.motif).length - 1;
  if (n !== 1) return { k, m, ko: `motif trouvé ${n} fois dans ${m.fichier} : la table est à mettre à jour` };
  if (m.attend && !existsSync(m.attend)) return { k, m, attente: `en attente de ${m.attend}` };
  const md = await jouer(k);
  if (md === undefined) return { k, m, ko: 'aucun relevé écrit : la suite ne charge plus' };
  const r = echecs(md);
  const par = {};
  for (const x of r) par[x.source] = (par[x.source] ?? 0) + 1;
  const [major] = Object.entries(par).sort((x, y) => y[1] - x[1]);
  const ko =
    r.length === 0 ? 'survit' : major[0] !== m.maillon ? `nomme ${major[0]}, pas ${m.maillon}` : undefined;
  return { k, m, r, par, ko };
};

const res = await Promise.all(Object.entries(table).map(([k, m]) => juger(k, m)));
const sources = (par) =>
  Object.entries(par)
    .sort((x, y) => y[1] - x[1])
    .map(([s, n]) => `${s} ${n}`)
    .join(', ');

for (const x of res) {
  const etat = x.attente ?? (x.ko ? `ÉCHEC : ${x.ko}` : 'tuée');
  const detail = x.r ? ` | ${x.r.length} échecs | ${sources(x.par)}` : '';
  console.log(`${x.k}. ${x.m.quoi} (${x.m.maillon}) | ${etat}${detail}`);
}
console.log('\n| Mutation | Maillon attendu | Scénarios en échec | Sources nommées | Verdict |');
console.log('|---|---|---|---|---|');
for (const x of res) {
  const noms = x.r ? [...new Set(x.r.map((e) => e.nom))] : [];
  const verdict = x.attente ?? (x.ko ? `échec : ${x.ko}` : 'tuée');
  const cols = [
    `${x.k}. ${x.m.quoi}`,
    x.m.maillon,
    noms.length ? `${noms.length} (${noms.join(', ')})` : '—',
  ];
  console.log(`| ${[...cols, x.par ? sources(x.par) : '—', verdict].join(' | ')} |`);
}
console.log(`\nDurée : ${((Date.now() - debut) / 1000).toFixed(1)} s.`);
if (res.some((x) => x.ko)) process.exit(1);
