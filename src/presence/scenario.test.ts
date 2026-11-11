import { describe, expect, it } from 'vitest';
import { SYNTH_TIMEOUT_MS } from '../speech/speaker.ts';
import {
  ancre,
  charger,
  morceaux,
  ScenarioRefuse,
  type Attendu,
  type AttenduEvenement,
  type BancEvent,
  type Parole,
  type Scenario,
} from './scenario.ts';

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

describe('a speech anchored on the game', () => {
  const modele = { reponses: [{ si: 'bonjour', phrases: ['Salut.', 'Ça va ?'] }] };
  const deux = (p: Parole): Partial<Scenario> => ({ modele, personne: [base.personne[0]!, p] });
  const encore = { dit: 'Encore', duree: 400 };

  it('takes an instant or an anchor, not both, not neither; a gesture too', () => {
    expect(charger({ ...base, ...deux({ ...encore, apres: { joue: 1, phrase: 2, ms: 100 } }) })).toBeTruthy();
    expect(refus(deux(encore))).toEqual(['parole 2 : ni a ni apres']);
    expect(refus(deux({ ...encore, a: 900, apres: { envoi: 1, ms: 0 } }))).toEqual([
      'parole 2 : a et apres à la fois',
    ]);
    expect(refus({ gestes: [{ geste: 'silence' }] })).toEqual(['geste 1 : ni a ni apres']);
  });

  it('refuses an anchor on a reply or a sentence the model does not plan', () => {
    expect(refus(deux({ ...encore, apres: { joue: 1, phrase: 3, ms: 0 } }))).toEqual([
      'parole 2 : ancre vers la phrase 3 de la réponse 1, que modele ne prévoit pas',
    ]);
    expect(refus(deux({ ...encore, apres: { joue: 2, ms: 0 } }))).toEqual([
      'parole 2 : ancre vers la réponse 2, que modele ne prévoit pas',
    ]);
    expect(refus({ gestes: [{ geste: 'silence', apres: { joue: 1, ms: 0 } }] })).toEqual([
      'geste 1 : ancre vers la réponse 1, que modele ne prévoit pas',
    ]);
  });

  it('checks the overlap of speeches at an instant only', () => {
    expect(
      charger({ ...base, ...deux({ ...encore, duree: 9000, apres: { envoi: 1, ms: 0 } }) }),
    ).toBeTruthy();
  });
});

describe('what the chain cannot hold', () => {
  const sans = { ...base, connus: [] };
  const ok = (attendus: Attendu[]) => charger({ ...sans, attendus });
  const tous = (a: Partial<AttenduEvenement>): Attendu => ({ ...voix, id: 'x', ...a }) as Attendu;
  const chaine = (attendus: Attendu[]) => {
    try {
      charger({ ...sans, attendus }, 'chaine');
    } catch (err) {
      return (err as ScenarioRefuse).raisons;
    }
    return [];
  };

  it('refuses, everywhere, a `tous` that compares the words heard of the person', () => {
    const texte = tous({ evenement: 'envoi_recu', ou: { valeurs: { texte: 'Bonjour' } } });
    expect(refus({ connus: [], attendus: [texte] })).toEqual([
      '« x » : tous, compare les mots entendus de la personne',
    ]);
    expect(
      refus({ connus: [], attendus: [tous({ evenement: 'transcrite', ou: { valeurs: { entendu: '' } } })] }),
    ).toHaveLength(1);
    // Her own words heard, at the cut, are hers: they stay the same.
    expect(ok([tous({ evenement: 'coupure_recue', ou: { valeurs: { entendu: '' } } })])).toBeTruthy();
    expect(ok([{ ...texte, niveau: 'exact' } as Attendu])).toBeTruthy();
  });

  it('refuses, in the chain, a `tous` anchored on an `exact`', () => {
    const sur = tous({ depuis: { attendu: 'fin' } });
    expect(chaine([voix, fin, sur])).toEqual(['« x » : tous, ancré sur « fin », exact']);
    expect(ok([voix, fin, sur])).toBeTruthy();
  });

  it('refuses, in the chain, a `tous` on a server line with bounds or an anchor, or that anchors another', () => {
    const recue = tous({ id: 'recue', evenement: 'coupure_recue' });
    expect(chaine([recue])).toEqual([]);
    expect(chaine([{ ...recue, entre: [0, 10] } as Attendu])).toHaveLength(1);
    expect(chaine([voix, { ...recue, depuis: { attendu: 'voix' } } as Attendu])).toHaveLength(1);
    expect(chaine([recue, tous({ depuis: { attendu: 'recue' } })])).toEqual([
      '« recue » : tous, une ligne du serveur avec bornes ou ancre, sans instant dans la chaîne',
    ]);
    expect(ok([{ ...recue, entre: [0, 10] } as Attendu])).toBeTruthy();
  });
});

describe('morceaux', () => {
  it('cuts the first sentence at its first comma, as the real server does, and only it', () => {
    expect(
      morceaux(['Demain matin il fera frais, puis le soleil reviendra.', 'Le soir, la pluie arrivera.']),
    ).toEqual([
      ['Demain matin il fera frais,', 'puis le soleil reviendra.'],
      ['Le soir, la pluie arrivera.'],
    ]);
  });

  it('keeps whole a first sentence without a comma outside brackets, or whose comma comes too early', () => {
    expect(morceaux(['Bonjour.'])).toEqual([['Bonjour.']]);
    expect(morceaux(['A, b.'])).toEqual([['A, b.']]);
    expect(morceaux(['Un (deux, trois) quatre.'])).toEqual([['Un (deux, trois) quatre.']]);
    expect(morceaux(['Un (deux) trois, quatre.'])).toEqual([['Un (deux) trois,', 'quatre.']]);
    expect(morceaux([])).toEqual([]);
  });
});

describe('ancre', () => {
  const journal: BancEvent[] = [
    { de: 'banc', at: 100, name: 'envoi_recu', reponse: 101 },
    { de: 'banc', at: 600, name: 'joue', reponse: 101, texte: 'Un.' },
    { de: 'banc', at: 900, name: 'joue', reponse: 101, texte: 'Deux.' },
    { de: 'banc', at: 1200, name: 'envoi_recu', reponse: 102 },
  ];

  it('gives the instant after the start of a sentence of a reply, or after a text received', () => {
    expect(ancre({ joue: 1, ms: 1000 }, journal)).toBe(1600);
    expect(ancre({ joue: 1, phrase: 2, ms: 50 }, journal)).toBe(950);
    expect(ancre({ envoi: 2, ms: 3000 }, journal)).toBe(4200);
  });

  it('takes the sentence by its number when the log gives it: one played again after a suspension is not the next', () => {
    const sonde: BancEvent[] = [
      { de: 'banc', at: 100, name: 'envoi_recu', reponse: 101 },
      { de: 'banc', at: 600, name: 'joue', reponse: 101, phrase: 1 },
      { de: 'banc', at: 900, name: 'joue', reponse: 101, phrase: 1 },
      { de: 'banc', at: 1500, name: 'joue', reponse: 101, phrase: 2 },
    ];
    expect(ancre({ joue: 1, phrase: 2, ms: 0 }, sonde)).toBe(1500);
    expect(ancre({ joue: 1, ms: 0 }, sonde)).toBe(600);
    expect(ancre({ joue: 1, phrase: 3, ms: 0 }, sonde)).toBeUndefined();
  });

  it('gives nothing while the anchor has not come', () => {
    expect(ancre({ joue: 2, ms: 0 }, journal)).toBeUndefined();
    expect(ancre({ joue: 1, phrase: 3, ms: 0 }, journal)).toBeUndefined();
    expect(ancre({ envoi: 3, ms: 0 }, journal)).toBeUndefined();
  });
});
