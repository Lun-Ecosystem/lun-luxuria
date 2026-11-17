// Moitié serveur, hors de ce niveau : la file d'une page seulement. La cause de ce que CrOliX a entendu le 10/11
// (lun-luxuria#48) n'est pas prouvée ; la lecture la plus probable de l'enquête est deux réponses à la suite, parce
// qu'avant lun-luxuria#51 `speaking` était faux dans le trou entre deux phrases d'une même réponse, pendant la
// synthèse de la suivante : une parole dite là ne coupait rien. Ce scénario garde cette correction : la parole 2
// commence dans le trou, la réponse 1 est suspendue à sa tenue, coupée, et ne sonne plus. Sous la mutation
// `speaking-sans-trou` (l'ancien `speaking`), la suspension n'a pas lieu à la tenue : la phrase 2 de la réponse 1
// sonne par-dessus la personne, puis elle est coupée au verdict.
//
// Les réglages sont ceux par défaut (coupure allumée, mode `now`). La synthèse met 1200 ms par phrase (la même pour
// toutes, les fausses briques n'en règlent pas une seule) : la phrase 1, courte, finit de sonner bien avant que la
// phrase 2 soit prête, d'où un trou ; la parole 2 commence dedans, ancrée sur le premier son de la réponse 1.
//
// Le calcul (trames de 32 ms, tenue 400) :
// - parole 1, 320 → 1600, envoyée à 1878 ; la réponse 1 a ses trois phrases reçues à 2278 (+300 +300).
// - phrase 1 : synthèse 2278 → 3478, sonne 3478 → 4018 (« Bien sûr. », 9 car. × 60). Phrase 2 : synthèse 3478 → 4678.
// - trou : 4018 → 4678 (660 ms). Parole 2 à 3478 + 618 = 4096 : tenue à 4480, avant le son de la phrase 2.
import type { Scenario } from '../scenario.ts';

export default {
  nom: 'deux-tours-trou',
  source:
    'une phrase dite dans le trou entre deux phrases de sa réponse : elle la coupe, la réponse 2 passe seule ;',
  apport:
    "une parole qui commence entre deux phrases d'une réponse retient cette réponse, que la file en soit à la synthèse de la suivante",
  mecanismes: ['ecoute', 'essai', 'transcription', 'filtre', 'suspension', 'coupure', 'serveur', 'voix'],
  voix: { syntheseMs: 1200 },
  personne: [
    { a: 320, dit: 'Tu peux me rappeler le film de ce soir', duree: 1280 },
    { apres: { joue: 1, ms: 618 }, dit: 'Et aussi la météo de demain', duree: 1280 },
  ],
  modele: {
    reponses: [
      {
        si: 'film',
        phrases: [
          'Bien sûr.',
          'Ce soir il y a un vieux western à vingt et une heures.',
          'Sur la deuxième chaîne.',
        ],
      },
      { si: 'meteo', phrases: ['Demain il fera beau.'] },
    ],
  },
  attendus: [
    {
      id: 'phrase-1-dite',
      niveau: 'tous',
      mecanisme: 'voix',
      dit: 'la phrase 1 de la réponse 1 a fini de sonner',
      evenement: 'arrete',
      ou: { reponse: 1 },
    },
    {
      id: 'parole-dans-le-trou',
      niveau: 'tous',
      mecanisme: 'ecoute',
      dit: "la parole 2 commence dans le trou : la phrase 1 a fini, la phrase 2 n'a pas commencé",
      evenement: 'parole',
      ou: { valeurs: { etape: 'debut' } },
      depuis: { attendu: 'phrase-1-dite' },
      entre: [1, 500],
    },
    {
      id: 'reponse-1-muette-ensuite',
      niveau: 'tous',
      mecanisme: 'voix',
      dit: 'aucune autre phrase de la réponse 1 ne sonne',
      evenement: 'joue',
      ou: { reponse: 1 },
      depuis: { attendu: 'phrase-1-dite' },
      absent: true,
    },
    {
      id: 'suspendue',
      niveau: 'tous',
      mecanisme: 'suspension',
      dit: 'la parole 2 suspend la réponse 1, entre ses phrases',
      evenement: 'suspendue',
      ou: { reponse: 1 },
      depuis: { parole: 2, bord: 'debut' },
    },
    {
      id: 'suspendue-a-la-tenue',
      niveau: 'exact',
      mecanisme: 'suspension',
      dit: 'la réponse 1 est suspendue à la tenue de la parole 2, pas plus tard',
      evenement: 'suspendue',
      ou: { reponse: 1 },
      depuis: { parole: 2, bord: 'debut' },
      // tenue à 384 ms du début, une trame de marge
      entre: [384, 416],
    },
    {
      id: 'coupee',
      niveau: 'tous',
      mecanisme: 'coupure',
      dit: 'le serveur reçoit la coupure de la réponse 1, avec la seule phrase entendue',
      evenement: 'coupure_recue',
      ou: { reponse: 1, valeurs: { entendu: 'Bien sûr.' } },
    },
    {
      id: 'premier-son-2',
      niveau: 'tous',
      mecanisme: 'voix',
      dit: 'la réponse 2 sonne',
      evenement: 'premier_son',
      ou: { reponse: 2 },
    },
    {
      id: 'reponses-ensemble',
      niveau: 'tous',
      mecanisme: 'voix',
      dit: 'jamais deux réponses ensemble',
      mesure: 'reponses_ensemble',
      entre: [0, 0],
    },
  ],
} satisfies Scenario;
