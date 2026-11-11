// Moitié serveur : aucune.
//
// « Juste après une toux » se lit ici après la fin de la phrase de la toux, quand elle a repris : une parole qui
// commence moins de 700 ms après la toux en est la suite (une reprise de l'écoute, pas une nouvelle phrase), et elle
// ne reprend jamais par-dessus. La toux est un bruit, pas une parole : seule la parole d'après compte dans le
// chevauchement.
//
// Le calcul (trames de 32 ms à partir de 0, DEFAUTS, réglages par défaut : pause 160, silence 700, tenue 400) :
// - elle parle seule à 1000 (pourquoi : spontaneous), synthèse → son 1150, 83 car. × 60 = 4980 ms.
// - la toux, 2016 → 2466 : tenue 2016 + 384 = 2400 → suspendue, son arrêté ; dernière trame 2464 ; pause 2624 →
//   essai, transcrite vide 2774 → bruit ; fin 2464 + 704 = 3168 → sans réponse → reprise, la phrase redite à 3168.
// - parole 1, 3360 → 4960, 192 ms après cette fin (200 à la trame près) : une nouvelle phrase, elle parle par-dessus
//   jusqu'à sa tenue 3360 + 384 = 3744 → suspendue. Chevauchement : 3744 − 3360 = 384, au plus une tenue et une
//   trame (432) ; le voulu est nul.
// - dernière trame 4928 ; pause 5088 → essai, pour elle ; fin 4928 + 704 = 5632 → confirmée → coupée.
import type { Scenario } from '../scenario.ts';

export default {
  nom: 'toux-puis-parole',
  source: 'recommencer à parler juste après une toux : noter si elle reprend par-dessus.',
  apport: 'la course entre la reprise après la toux et la nouvelle parole, que seul le temps produit',
  mecanismes: ['ecoute', 'essai', 'transcription', 'filtre', 'suspension', 'coupure', 'serveur', 'voix'],
  personne: [{ a: 3360, dit: 'Bon, je reprends ce que je disais', duree: 1600 }],
  bruits: [{ a: 2016, duree: 450, voix: 0.9 }],
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
      id: 'reprise',
      niveau: 'tous',
      mecanisme: 'suspension',
      dit: 'elle reprend après la toux',
      evenement: 'reprise_voix',
      ou: { parle: 1 },
    },
    {
      id: 'suspendue-par-la-parole',
      niveau: 'exact',
      mecanisme: 'suspension',
      dit: 'la nouvelle parole la suspend à sa tenue',
      evenement: 'suspendue',
      ou: { parle: 1 },
      depuis: { parole: 1, bord: 'debut' },
      // tenue à 384 ms du début, une trame de marge
      entre: [384, 416],
    },
    {
      id: 'chevauchement-garanti',
      niveau: 'tous',
      mecanisme: 'suspension',
      dit: "elle ne parle pas par-dessus plus d'une tenue et une trame",
      mesure: 'chevauchement',
      // 400 + 32
      entre: [0, 432],
    },
    {
      id: 'chevauchement-nul',
      niveau: 'tous',
      mecanisme: 'suspension',
      dit: 'elle ne reprend pas par-dessus',
      mesure: 'chevauchement',
      entre: [0, 0],
    },
  ],
  connus: [
    {
      issue: 'Lun-Ecosystem/lun-luxuria#63',
      attendu: 'chevauchement-nul',
      espece: 'hors_bornes',
      // une tenue, de 3360 à 3744
      trouve: 384,
    },
  ],
} satisfies Scenario;
