import { passe, type Verdict } from './judge.ts';

/** One scenario judged: what the report is made of. */
export interface Juge {
  nom: string;
  verdicts: Verdict[];
}

const compte = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;

const parCle = (vs: Verdict[], cle: (v: Verdict) => string) => {
  const n = new Map<string, number>();
  for (const v of vs) n.set(cle(v), (n.get(cle(v)) ?? 0) + 1);
  return n.size === 0 ? 'aucun' : [...n].map(([k, c]) => `${k} ${c}`).join(', ');
};

const cellule = (x: unknown) => (x === undefined ? '' : String(x).replaceAll('|', '\\|'));

const etat = (v: Verdict) =>
  v.connu ? `${v.connu.conforme ? 'connue' : `${v.etat}, connue ailleurs`} (${v.connu.issue})` : v.etat;

// The link it names on its own, when the game's first failure is named instead: a second defect is not hidden.
const source = (v: Verdict) =>
  v.propre && v.propre !== v.source ? `${v.source} (propre : ${v.propre})` : v.source;

/** The report in Markdown: counts, failures by species then by source, a table per scenario, each failure's excerpt. */
export function releve(juges: Juge[]): string {
  const tous = juges.flatMap((j) => j.verdicts);
  const echecs = tous.filter((v) => !passe(v));
  const connues = tous.filter((v) => v.connu?.conforme).length;
  const sans = tous.filter((v) => !v.connu?.conforme);
  const out = [
    '# Relevé des scénarios',
    '',
    `Attentes : ${[
      compte(sans.filter((v) => v.etat === 'tenue').length, 'tenue', 'tenues'),
      compte(sans.filter((v) => v.etat === 'ratee').length, 'ratée', 'ratées'),
      compte(connues, 'connue', 'connues'),
      compte(sans.filter((v) => v.etat === 'non_jouee').length, 'non jouée', 'non jouées'),
    ].join(', ')}.`,
    '',
    // A known defect that holds now has no species: it failed by changing.
    `Échecs par espèce : ${parCle(echecs, (v) => v.espece ?? 'connu_change')}.`,
    '',
    `Échecs par source : ${parCle(echecs, (v) => v.source ?? v.mecanisme)}.`,
    '',
  ];
  for (const j of juges) {
    out.push(
      `## ${j.nom}`,
      '',
      '| Attendu | État | Espèce | Source | Trouvé | Borne |',
      '|---|---|---|---|---|---|',
      ...j.verdicts.map(
        (v) =>
          `| ${[v.id, etat(v), v.espece, source(v), v.trouve, v.borne && `[${v.borne.join(', ')}]`]
            .map(cellule)
            .join(' | ')} |`,
      ),
      '',
    );
    for (const v of j.verdicts.filter((x) => !passe(x))) {
      out.push(
        `### ${v.id} : ${v.dit}`,
        '',
        `Couverture : ${v.couverture.length ? v.couverture.join(', ') : 'aucune'}.`,
        '',
      );
      if (v.extrait.length) out.push('```', ...v.extrait, '```', '');
    }
  }
  return out.join('\n');
}
