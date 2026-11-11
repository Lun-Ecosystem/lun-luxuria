import { describe, expect, it } from 'vitest';
import { SYNTH_TIMEOUT_MS } from '../speech/speaker.ts';
import { charger, ScenarioRefuse, type Attendu, type Scenario } from './scenario.ts';

const voix: Attendu = {
  id: 'voix',
  niveau: 'tous',
  mecanisme: 'ecoute',
  dit: 'elle entend',
  evenement: 'voix',
};
const fin: Attendu = {
  id: 'fin',
  niveau: 'exact',
  mecanisme: 'ecoute',
  dit: 'la phrase se ferme',
  evenement: 'fin',
  depuis: { attendu: 'voix' },
  entre: [700, 736],
};

const base: Scenario = {
  nom: 'essai',
  source: 'un point',
  apport: 'rien',
  mecanismes: ['ecoute', 'transcription', 'retenue', 'suspension', 'voix'],
  personne: [
    { a: 0, dit: 'Bonjour', duree: 600 },
    { a: 600, dit: 'Encore', duree: 400 },
  ],
  voix: { syntheseMs: SYNTH_TIMEOUT_MS - 1 },
  attendus: [
    voix,
    fin,
    {
      id: 'delai',
      niveau: 'exact',
      mecanisme: 'ecoute',
      dit: '',
      delai: 'attente_fin',
      tour: { parole: 1 },
      entre: [0, 0],
    },
  ],
  connus: [{ issue: 'lun-luxuria#0', attendu: 'fin', espece: 'hors_bornes', trouve: 740 }],
};

const refus = (s: Partial<Scenario>) => {
  try {
    charger({ ...base, ...s });
  } catch (err) {
    expect(err).toBeInstanceOf(ScenarioRefuse);
    return (err as ScenarioRefuse).raisons;
  }
  throw new Error('accepté');
};

describe('loading a scenario', () => {
  it('gives back a well written one as it is, data only', () => {
    expect(charger(base)).toBe(base);
    expect(JSON.parse(JSON.stringify(base))).toEqual(base);
  });

  it('refuses an anchor to an unknown expectation, or to one without an instant', () => {
    expect(refus({ attendus: [{ ...fin, depuis: { attendu: 'rien' } }] })).toEqual([
      '« fin » : ancre vers « rien », inconnu',
    ]);
    expect(refus({ attendus: [{ ...voix, absent: true }, fin] })[0]).toMatch(/pas d'instant/);
  });

  it('refuses anchors in a loop', () => {
    expect(refus({ attendus: [{ ...voix, depuis: { attendu: 'fin' } }, fin] })).toEqual([
      '« voix » : ancres en boucle',
      '« fin » : ancres en boucle',
    ]);
  });

  it('refuses bounds the wrong way', () => {
    expect(refus({ attendus: [voix, { ...fin, entre: [736, 700] }] })).toEqual([
      '« fin » : bornes inversées',
    ]);
  });

  it('refuses two expectations of the same id', () => {
    expect(refus({ attendus: [voix, fin, { ...fin }] })).toEqual(['deux attendus « fin »']);
  });

  it('refuses a known defect naming an absent expectation', () => {
    expect(refus({ connus: [{ issue: 'x', attendu: 'rien', espece: 'absent' }] })).toEqual([
      'connu (x) : attendu « rien » absent',
    ]);
  });

  it('refuses two speeches that overlap, whatever their order', () => {
    expect(
      refus({
        personne: [
          { a: 500, dit: 'Encore', duree: 400 },
          { a: 0, dit: 'Bonjour', duree: 600 },
        ],
      }),
    ).toEqual(['paroles à 0 et 500 : elles se chevauchent']);
  });

  it('refuses a synthesis her voice would give up', () => {
    expect(refus({ voix: { syntheseMs: SYNTH_TIMEOUT_MS } })[0]).toMatch(/syntheseMs 5000/);
  });

  it('refuses links out of the order of the chain, or twice; two of the same rank go either way', () => {
    expect(refus({ mecanismes: ['voix', 'ecoute'] })).toEqual([
      "mécanismes : ecoute après voix, hors de l'ordre de la chaîne",
    ]);
    expect(refus({ mecanismes: ['ecoute', 'ecoute'] })).toHaveLength(1);
    expect(charger({ ...base, mecanismes: ['ecoute', 'suspension', 'retenue'] }).mecanismes).toHaveLength(3);
  });

  it('refuses an expectation on a link the scenario does not play, unless it says that link stays silent', () => {
    const coupure: Attendu = { ...voix, id: 'coupure', mecanisme: 'coupure', evenement: 'coupee' };
    expect(refus({ attendus: [...base.attendus, coupure] })).toEqual([
      '« coupure » : mécanisme coupure hors des mécanismes du scénario',
    ]);
    const muet = { ...coupure, absent: true } as Attendu;
    expect(charger({ ...base, attendus: [...base.attendus, muet] }).attendus).toContain(muet);
  });

  it('gives every reason at once', () => {
    expect(refus({ attendus: [voix, voix], mecanismes: ['voix', 'ecoute'] })).toHaveLength(3);
  });
});
