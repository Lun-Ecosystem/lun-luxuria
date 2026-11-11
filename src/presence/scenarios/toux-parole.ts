// Moitié serveur : aucune.
//
// Le calcul (trames de 32 ms à partir de 0, DEFAUTS, réglages par défaut : pause 160, silence 700, tenue 400) :
// - parole 1, 320 → 1600 : dernière trame 1568 ; pause 1728 → essai ; transcrite 1878 → envoyée (réponse 1) ;
//   fin 2272 → confirmée. Phrase 1 reçue 2278, synthèse → son 2428, 83 car. × 60 = 4980 ms.
// - la toux, parole 2, 3008 → 3458 (450 ms) : tenue 3008 + 384 = 3392 → suspendue, son arrêté.
//   Dernière trame 3456 ; pause 3616 → essai, transcrite vide 3766 → bruit ; fin 3456 + 704 = 4160 → sans
//   réponse → reprise : la phrase 1 est redite depuis son début à 4160.
//   Le blanc, de l'arrêt à la phrase redite : 4160 − 3392 = 768 (dernière trame 448 après le début, + 704, − 384).
import type { Scenario } from '../scenario.ts';

export default {
  nom: 'toux-parole',
  source:
    "une toux pendant qu'elle parle : elle se tait, puis redit sa phrase et continue ; compter le blanc ;",
  apport: 'le seuil de 400 ms joué au-dessus, et la phrase redite lue dans ce qui sonne',
  mecanismes: ['ecoute', 'essai', 'transcription', 'filtre', 'suspension', 'serveur', 'voix'],
  personne: [
    { a: 320, dit: 'Raconte-moi la journée de demain', duree: 1280 },
    { a: 3008, dit: '(toux)', duree: 450, entendu: '' },
  ],
  modele: {
    reponses: [
      {
        phrases: [
          'Demain matin il fera frais, puis le soleil reviendra vers midi avec un peu de vent.',
          "Le soir, la pluie arrivera par l'ouest.",
        ],
      },
    ],
  },
  attendus: [
    {
      id: 'suspendue',
      niveau: 'exact',
      mecanisme: 'suspension',
      dit: 'elle se tait à 400 ms de toux, à une trame près',
      evenement: 'suspendue',
      ou: { reponse: 1, valeurs: { par: 2 } },
      depuis: { parole: 2, bord: 'debut' },
      // tenue à 384 ms du début de la toux, une trame de marge
      entre: [384, 416],
    },
    {
      id: 'arrete',
      niveau: 'tous',
      mecanisme: 'voix',
      dit: "son son s'arrête",
      evenement: 'arrete',
      ou: { reponse: 1 },
      depuis: { parole: 2, bord: 'debut' },
    },
    {
      id: 'reprise',
      niveau: 'tous',
      mecanisme: 'suspension',
      dit: 'elle reprend',
      evenement: 'reprise_voix',
      ou: { reponse: 1 },
    },
    {
      id: 'redite-dans-le-deroule',
      niveau: 'tous',
      mecanisme: 'voix',
      dit: 'le son suivant est la phrase 1 de la réponse',
      evenement: 'son',
      ou: { reponse: 1, valeurs: { etape: 'debut', rang: 1 } },
      depuis: { attendu: 'arrete' },
    },
    {
      id: 'redite',
      niveau: 'tous',
      mecanisme: 'voix',
      dit: 'elle redit la phrase coupée',
      evenement: 'joue',
      ou: {
        reponse: 1,
        valeurs: {
          texte: 'Demain matin il fera frais, puis le soleil reviendra vers midi avec un peu de vent.',
        },
      },
      depuis: { attendu: 'arrete' },
    },
    {
      id: 'blanc',
      niveau: 'exact',
      mecanisme: 'voix',
      dit: "le blanc entre l'arrêt et la phrase redite",
      evenement: 'joue',
      ou: {
        reponse: 1,
        valeurs: {
          texte: 'Demain matin il fera frais, puis le soleil reviendra vers midi avec un peu de vent.',
        },
      },
      depuis: { attendu: 'arrete' },
      // 4160 − 3392 = 768, une trame de marge
      entre: [768, 800],
    },
  ],
} satisfies Scenario;
