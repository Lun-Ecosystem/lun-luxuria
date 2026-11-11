// Moitié serveur : aucune.
//
// Le calcul (trames de 32 ms à partir de 0, DEFAUTS, réglages par défaut : pause 160, silence 700, tenue 400,
// coupure « tout de suite ») :
// - parole 1, 320 → 1600 : envoyée à 1878 (réponse 1), confirmée à 2272 ; phrase 1 reçue 2278, son 2428, 83 car. ×
//   60 = 4980 ms, 16 mots.
// - « non », parole 2, 3136 → 3436 (300 ms) : 10 trames, 320 ms d'affilée < 384 : aucune tenue, elle parle encore.
//   Dernière trame 3424 ; pause 3584 → essai, transcrite 3734 → pour elle (pas encore confirmé) ; fin 3424 + 704 =
//   4128 → confirmée : la coupure part là, pas au verdict — l'essai à la pause n'est pour elle qu'à la fin de la
//   phrase. Son arrêté 4128 − 2428 = 1700 ms après son début : 0,341 → 5 mots sur 16 (de 1556 à 1867 ms).
import type { Scenario } from '../scenario.ts';

export default {
  nom: 'non-court',
  source:
    "« arrête » ou « non » pendant une longue réponse : elle se tait pour de bon ; / la couper en cours de phrase (tout de suite, puis en fin de phrase) et vérifier ce qu'elle dit avoir été entendue",
  apport:
    'un « non » trop court pour la suspendre la coupe quand même, une fois la phrase finie et pour elle',
  mecanismes: ['ecoute', 'essai', 'transcription', 'filtre', 'suspension', 'coupure', 'serveur', 'voix'],
  personne: [
    { a: 320, dit: 'Raconte-moi la journée de demain', duree: 1280 },
    { a: 3136, dit: 'Non', duree: 300 },
  ],
  modele: {
    reponses: [
      { si: 'non', phrases: ["D'accord."] },
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
      id: 'pas-de-tenue',
      niveau: 'exact',
      mecanisme: 'ecoute',
      dit: '« non » ne fait pas de tenue',
      evenement: 'tenue',
      ou: { parole: 2 },
      absent: true,
    },
    {
      id: 'son-arrete',
      niveau: 'exact',
      mecanisme: 'suspension',
      dit: 'son son est arrêté à la fin de « non »',
      evenement: 'son',
      ou: { reponse: 1, valeurs: { etape: 'fin', arrete: true, par: 2 } },
      depuis: { parole: 2, bord: 'fin' },
      // fin à 3424 + 704 = 4128, soit 692 ms après le bord 3436 ; une trame de marge
      entre: [692, 724],
    },
    {
      id: 'coupee',
      niveau: 'exact',
      mecanisme: 'coupure',
      dit: 'coupée, cinq mots entendus sur seize',
      evenement: 'coupee',
      ou: { reponse: 1, valeurs: { entendu: 'Demain matin il fera frais,' } },
    },
    {
      id: 'coupure-recue',
      niveau: 'exact',
      mecanisme: 'coupure',
      dit: 'le serveur reçoit les mots entendus',
      evenement: 'coupure_recue',
      ou: { reponse: 1, valeurs: { entendu: 'Demain matin il fera frais,' } },
    },
    {
      id: 'pour-de-bon',
      niveau: 'tous',
      mecanisme: 'voix',
      dit: 'plus rien de la réponse 1 ne sonne',
      evenement: 'joue',
      ou: { reponse: 1 },
      depuis: { attendu: 'son-arrete' },
      absent: true,
    },
  ],
} satisfies Scenario;
