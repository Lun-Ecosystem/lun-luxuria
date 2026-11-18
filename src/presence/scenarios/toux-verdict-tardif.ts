// Moitié serveur : aucune.
//
// I8 : le verdict de la toux tombe après que la parole d'après a commencé, avant sa tenue. Une phrase commencée
// empêche la reprise : elle ne reprend pas par-dessus, ni à ce verdict, ni avant la fin de cette parole. La toux
// est une parole `(toux)` transcrite vide, pour porter `transcriptionMs` (un bruit du scénario n'en a pas) ; seule la
// parole 2 compte, et aucun attendu `chevauchement-*` : celui de la toux elle-même y entrerait.
//
// Le calcul (trames de 32 ms à partir de 0, réglages par défaut : pause 160, silence 700, tenue 400) :
// - elle parle seule à 1000 (pourquoi : spontaneous), son 1150, la phrase 1 coupée à sa virgule, 1620 ms.
// - la toux, parole 1, 2016 → 2466 : tenue 2016 + 384 = 2400 → suspendue ; dernière trame 2464 ; pause 2624 → essai,
//   transcrit 800 ms plus tard : 3424 ; fin 2464 + 704 = 3168 → confirmée, son verdict reste à venir.
// - parole 2, 3360 → 4960 : elle commence 192 ms après la fin de la toux, avant son verdict (3424). Sa tenue :
//   3360 + 384 = 3744. Sur `main`, le verdict la reprend à 3424, 64 ms après le début de la parole : elle parle
//   par-dessus jusqu'à la tenue.
import type { Scenario } from '../scenario.ts';

export default {
  nom: 'toux-verdict-tardif',
  source: "la toux jugée après que la parole d'après a commencé : elle ne reprend pas par-dessus ;",
  apport: 'I8 : un verdict qui tombe dans une phrase commencée ne relâche pas sa voix',
  // Sans attente : avec elle, la reprise viendrait à 3724, à 20 ms de la tenue, et `debut-oublie` mordrait à peine.
  reglages: { bargeIn: { resumeMs: 0 } },
  mecanismes: ['ecoute', 'essai', 'transcription', 'filtre', 'suspension', 'coupure', 'serveur', 'voix'],
  personne: [
    { a: 2016, dit: '(toux)', duree: 450, entendu: '', transcriptionMs: 800 },
    { a: 3360, dit: 'Bon, je reprends ce que je disais', duree: 1600 },
  ],
  modele: {
    parle: [
      {
        a: 1000,
        pourquoi: 'spontaneous',
        phrases: [
          'Demain matin il fera frais, puis le soleil reviendra vers midi avec un peu de vent.',
          "Le soir, la pluie arrivera par l'ouest.",
        ],
      },
    ],
    reponses: [{ phrases: ["Vas-y, je t'écoute."] }],
  },
  attendus: [
    {
      id: 'verdict-bruit',
      niveau: 'tous',
      mecanisme: 'filtre',
      dit: 'la toux transcrite vide est jugée bruit',
      evenement: 'verdict',
      ou: { parole: 1, valeurs: { resultat: 'bruit' } },
    },
    {
      id: 'verdict-apres-le-debut',
      niveau: 'exact',
      mecanisme: 'transcription',
      dit: "le verdict de la toux tombe dans la parole 2, qui a déjà commencé (la condition d'I8)",
      evenement: 'verdict',
      ou: { parole: 1, valeurs: { resultat: 'bruit' } },
      depuis: { parole: 2, bord: 'debut' },
      // 3424 − 3360 = 64, une trame de marge
      entre: [32, 96],
    },
    {
      id: 'pas-de-reprise',
      niveau: 'tous',
      mecanisme: 'suspension',
      dit: 'aucune reprise entre le début de la parole 2 et sa fin',
      evenement: 'reprise_voix',
      ou: { parle: 1 },
      depuis: { parole: 2, bord: 'debut' },
      absent: true,
      entre: [0, 1600],
    },
  ],
} satisfies Scenario;
