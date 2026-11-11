import { delays, type TraceEvent, type TraceValue } from '../trace.ts';
import {
  charger,
  ECRIT_PAR,
  RANG,
  ScenarioRefuse,
  type Ancre,
  type Attendu,
  type AttenduEvenement,
  type BancEvent,
  type Espece,
  type Filtre,
  type Mecanisme,
  type Niveau,
  type Partie,
  type Scenario,
  type Tour,
} from './scenario.ts';

/** What the judge says of one expectation. Rules only: no model, texts compared by equality. */
export interface Verdict {
  id: string;
  niveau: Niveau;
  mecanisme: Mecanisme;
  dit: string;
  etat: 'tenue' | 'ratee' | 'non_jouee';
  espece?: Espece;
  /** The value found: ms from the anchor, the delay, the overlap, or the reason of a refusal. */
  trouve?: TraceValue;
  borne?: [number, number];
  /** The first link of the chain silent in the window, or the expectation's own link when all wrote. */
  source?: Mecanisme;
  /** The links that wrote in the window, in the order of the chain. */
  couverture: Mecanisme[];
  /** On a failure, the dated lines of the second around the window. */
  extrait: string[];
  /** A known defect: `conforme` while it gives its species and its value. */
  connu?: { issue: string; conforme: boolean };
}

/** The verdict lets the CI pass: held and not a known defect, or a known defect as it is known. */
export const passe = (v: Verdict): boolean => (v.connu ? v.connu.conforme : v.etat === 'tenue');

type Ligne = TraceEvent | BancEvent;

const CHAINE = (Object.keys(RANG) as Mecanisme[]).sort((a, b) => RANG[a] - RANG[b]);

const auteur = (e: Ligne): Mecanisme | undefined =>
  CHAINE.find((m) =>
    'de' in e
      ? (ECRIT_PAR[m].banc as readonly string[]).includes(e.name)
      : (ECRIT_PAR[m].page as readonly string[]).includes(e.name),
  );

const ligne = (e: Ligne) => {
  const { at, name, de, ...rest } = e as Ligne & { de?: string };
  const values = Object.entries(rest)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(' ');
  return `${at}  ${de ? `${de} ` : ''}${name}${values ? `  ${values}` : ''}`;
};

/** Every expectation of the scenario against one game: `joueur` for all if the game threw. */
export function juger(s: Scenario, partie: Partie): Verdict[] {
  const base = (a: Attendu) => ({
    id: a.id,
    niveau: a.niveau,
    mecanisme: a.mecanisme,
    dit: a.dit,
    ...(a.entre ? { borne: a.entre } : {}),
    couverture: [],
    extrait: [],
  });
  const tout = (espece: Espece, trouve: string): Verdict[] =>
    s.attendus.map((a) => ({ ...base(a), etat: 'ratee', espece, trouve }));
  try {
    charger(s);
  } catch (err) {
    if (err instanceof ScenarioRefuse) return tout('scenario', err.raisons.join(' ; '));
    throw err;
  }
  if (partie.format < 2)
    throw new Error(`déroulé au format ${partie.format} : le juge lit le format 2 au moins`);
  if (partie.erreur !== undefined) return tout('joueur', partie.erreur);

  // One clock: the page's trace and the player's log, merged; at the same instant the page first.
  const lignes: Ligne[] = [...partie.page, ...partie.banc].sort((x, y) => x.at - y.at);
  const finPartie = partie.fin;
  const bancDe = (name: string, f: (e: BancEvent) => boolean = () => true) =>
    partie.banc.filter((e) => e.name === name && f(e));

  const parole = (n: number, etape: 'debut' | 'fin') =>
    bancDe('parole', (e) => e['parole'] === n && e['etape'] === etape)[0]?.at;
  /** The phrase of the trace a turn names, or the reply. Undefined: the turn never came. */
  const resoudre = (t: Partial<Tour>): { phrase?: number; reponse?: number } | undefined => {
    if ('parole' in t && t.parole !== undefined) {
      const [debut, fin] = [parole(t.parole, 'debut'), parole(t.parole, 'fin') ?? Infinity];
      if (debut === undefined) return undefined;
      const son = (e: TraceEvent) => (typeof e['son'] === 'number' ? e['son'] : e.at);
      // The sentence it opens, or the one still open when it starts (it goes on a cough not ended yet).
      const ouverte = partie.page.filter((e) => e.name === 'voix' && son(e) <= fin).at(-1);
      if (ouverte?.phrase === undefined) return undefined;
      const close = partie.page.find(
        (e) => e.phrase === ouverte.phrase && (e.name === 'fin' || e.name === 'bruit'),
      );
      // Closed before it began: the speech opened nothing the listening heard.
      if (close && son(close) < debut) return undefined;
      return { phrase: ouverte.phrase };
    }
    if ('reponse' in t && t.reponse !== undefined) {
      // The false server says which number it gave; a trace without the log, the n-th number the page wrote.
      const r =
        bancDe('envoi_recu')[t.reponse - 1]?.reponse ??
        (bancDe('envoi_recu').length === 0
          ? partie.page.filter((e) => e.name === 'numero')[t.reponse - 1]?.reponse
          : undefined);
      return r === undefined ? undefined : { reponse: r };
    }
    if ('parle' in t && t.parle !== undefined) {
      const own = [
        ...new Set(
          partie.page.filter((e) => e.reponse !== undefined && e.phrase === undefined).map((e) => e.reponse),
        ),
      ];
      const r = own[t.parle - 1];
      return r === undefined ? undefined : { reponse: r };
    }
    return {};
  };

  const convient = (a: AttenduEvenement, tour: { phrase?: number; reponse?: number }) => (e: Ligne) => {
    const ou: Filtre = a.ou ?? {};
    if (e.name !== a.evenement) return false;
    if ('de' in e) {
      if ('parole' in ou && ou.parole !== undefined && e['parole'] !== ou.parole) return false;
    } else if (tour.phrase !== undefined && e.phrase !== tour.phrase) return false;
    if (tour.reponse !== undefined && e.reponse !== tour.reponse) return false;
    if (ou.essai !== undefined && e['essai'] !== ou.essai) return false;
    return Object.entries(ou.valeurs ?? {}).every(([k, v]) => e[k] === v);
  };

  // An event found for each expectation held: the instant another can be anchored on.
  const instants = new Map<string, number | undefined>();
  const verdicts = new Map<string, Verdict>();

  const fenetre = (lo: number, hi: number) => lignes.filter((e) => e.at >= lo && e.at <= hi);
  const couverture = (lo: number, hi: number) => {
    const ecrits = new Set(fenetre(lo, hi).map(auteur));
    return CHAINE.filter((m) => ecrits.has(m));
  };

  const ancre = (d: Ancre | undefined): number | undefined => {
    if (!d) return 0;
    if ('attendu' in d) {
      const cible = s.attendus.find((x) => x.id === d.attendu)!;
      if (juge(cible).etat !== 'tenue') return undefined;
      return instants.get(cible.id);
    }
    return parole(d.parole, d.bord);
  };

  const juge = (a: Attendu): Verdict => {
    const deja = verdicts.get(a.id);
    if (deja) return deja;
    let [lo, hi] = [0, finPartie];
    let r: Pick<Verdict, 'etat' | 'espece' | 'trouve'>;
    const hors = (x: number) => (a.entre && (x < a.entre[0] || x > a.entre[1])) || false;
    const nonJouee = { etat: 'non_jouee', espece: 'non_jouee' } as const;

    if ('evenement' in a) {
      const depuis = ancre(a.depuis);
      const tour = resoudre(a.ou ?? {});
      if (depuis === undefined || tour === undefined) r = nonJouee;
      else {
        [lo, hi] = a.entre ? [depuis + a.entre[0], depuis + a.entre[1]] : [depuis, finPartie];
        const ok = convient(a, tour);
        if (a.absent) {
          const trop = fenetre(lo, hi).find(ok);
          r = trop ? { etat: 'ratee', espece: 'en_trop', trouve: trop.at - depuis } : { etat: 'tenue' };
        } else {
          const e = lignes.find((x) => x.at >= depuis && ok(x));
          if (!e) r = { etat: 'ratee', espece: 'absent' };
          else {
            const trouve = e.at - depuis;
            r = hors(trouve) ? { etat: 'ratee', espece: 'hors_bornes', trouve } : { etat: 'tenue', trouve };
            if (r.etat === 'tenue') instants.set(a.id, e.at);
          }
        }
      }
    } else if ('delai' in a) {
      const tour = resoudre(a.tour);
      const turn =
        tour &&
        delays(partie.page).find((t) =>
          tour.phrase !== undefined ? t.phrase === tour.phrase : t.reponse === tour.reponse,
        );
      if (!tour || !turn) r = nonJouee;
      else {
        const own = partie.page.filter(
          (e) => (turn.phrase !== undefined && e.phrase === turn.phrase) || e.reponse === turn.reponse,
        );
        [lo, hi] = [Math.min(...own.map((e) => e.at)), Math.max(...own.map((e) => e.at))];
        const trouve = turn.ms[a.delai];
        r =
          trouve === undefined
            ? { etat: 'ratee', espece: 'delai_manquant' }
            : hors(trouve)
              ? { etat: 'ratee', espece: 'hors_bornes', trouve }
              : { etat: 'tenue', trouve };
      }
    } else {
      const trouve = chevauchement(partie.banc, finPartie);
      r = hors(trouve) ? { etat: 'ratee', espece: 'hors_bornes', trouve } : { etat: 'tenue', trouve };
    }

    const v: Verdict = {
      id: a.id,
      niveau: a.niveau,
      mecanisme: a.mecanisme,
      dit: a.dit,
      ...r,
      ...(a.entre ? { borne: a.entre } : {}),
      couverture: couverture(lo, hi),
      extrait: [],
    };
    if (v.etat !== 'tenue') {
      v.source = s.mecanismes.find((m) => !v.couverture.includes(m)) ?? a.mecanisme;
      v.extrait = fenetre(lo - 500, hi + 500).map(ligne);
    }
    const c = s.connus?.find((x) => x.attendu === a.id);
    if (c)
      v.connu = {
        issue: c.issue,
        conforme: v.etat !== 'tenue' && v.espece === c.espece && v.trouve === c.trouve,
      };
    verdicts.set(a.id, v);
    return v;
  };

  return s.attendus.map(juge);
}

/** The time a `parole` and a `joue` overlap: each speech against each sentence until its `arrete`. */
function chevauchement(banc: readonly BancEvent[], fin: number): number {
  const spans = (debut: (e: BancEvent) => boolean, end: (d: BancEvent, e: BancEvent) => boolean) =>
    banc.filter(debut).map((d) => {
      const e = banc.find((x) => x.at >= d.at && x !== d && end(d, x));
      return [d.at, e?.at ?? fin] as const;
    });
  const paroles = spans(
    (e) => e.name === 'parole' && e['etape'] === 'debut',
    (d, e) => e.name === 'parole' && e['etape'] === 'fin' && e['parole'] === d['parole'],
  );
  const sons = spans(
    (e) => e.name === 'joue',
    (d, e) => (e.name === 'arrete' || e.name === 'joue') && e.reponse === d.reponse,
  );
  let ms = 0;
  for (const [a, b] of paroles) for (const [c, d] of sons) ms += Math.max(0, Math.min(b, d) - Math.max(a, c));
  return ms;
}
