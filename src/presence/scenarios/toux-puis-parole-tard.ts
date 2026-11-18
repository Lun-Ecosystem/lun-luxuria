// Moitié serveur : aucune.
//
// Le jumeau de `toux-puis-parole`, sa limite gardée : l'attente avant de reprendre déplace la falaise, elle ne la
// supprime pas. La parole commence ici après l'attente, quand elle a repris : elle parle par-dessus jusqu'à la tenue,
// comme sur `main`. #63 reste ouverte pour cet écart (`connus`).
//
// Le calcul (trames de 32 ms à partir de 0, DEFAUTS, réglages par défaut : pause 160, silence 700, tenue 400,
// attente 300) :
// - elle parle seule à 1000 (pourquoi : spontaneous), synthèse → son 1150, la phrase 1 coupée à sa virgule
//   comme le fait le serveur, « Demain matin il fera frais, », 27 car. × 60 = 1620 ms.
// - la toux, 2016 → 2466 : tenue 2016 + 384 = 2400 → suspendue, son arrêté ; dernière trame 2464 ; pause 2624 →
//   essai, transcrite vide 2774 → bruit ; fin 2464 + 704 = 3168 → sans réponse → l'attente, jusqu'à 3468.
// - parole 1, 3568 → 5168, 400 ms après cette fin : elle a repris à 3468, la phrase redite sonne depuis 3468 + sa
//   synthèse. La tenue de la parole : 3568 + 384 = 3952, soit 3968 à la trame → suspendue. Chevauchement : de 3568 à la
//   tenue, 400 mesurés, au plus une tenue et une trame (432) ; le voulu est nul.
// - dernière trame 5136 ; pause 5296 → essai, pour elle ; fin 5136 + 704 = 5840 → confirmée → coupée.
import type { Scenario } from '../scenario.ts';

export default {
  nom: 'toux-puis-parole-tard',
  source: "recommencer à parler un peu après une toux : la limite de l'attente avant de reprendre.",
  apport: "la limite de l'attente de 300 ms : la parole qui vient après elle trouve sa voix reprise",
  mecanismes: ['ecoute', 'essai', 'transcription', 'filtre', 'suspension', 'coupure', 'serveur', 'voix'],
  personne: [{ a: 3568, dit: 'Bon, je reprends ce que je disais', duree: 1600 }],
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
      id: 'verdict-bruit',
      niveau: 'tous',
      mecanisme: 'filtre',
      // La toux est un bruit du scénario, pas une parole : sa phrase n'a pas de tour, le verdict se dit par sa valeur.
      dit: 'la toux transcrite vide est jugée bruit',
      evenement: 'verdict',
      ou: { valeurs: { resultat: 'bruit' } },
    },
    {
      id: 'reprise',
      niveau: 'tous',
      mecanisme: 'suspension',
      dit: "elle reprend après la toux, à la fin de l'attente",
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
      niveau: 'exact',
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
      // de 3568 à la tenue, 3968 : une tenue, mesurée à la trame près
      trouve: 400,
    },
  ],
} satisfies Scenario;
