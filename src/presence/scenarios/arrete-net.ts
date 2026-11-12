// Moitié serveur : aucune. La coupure « en fin de phrase » (mode doux) est sortie : conversation.test.ts:375 la
// prouve, et le niveau exact n'y ajoute rien.
//
// Le calcul (trames de 32 ms à partir de 0, DEFAUTS, réglages par défaut : pause 160, silence 700, tenue 400,
// coupure « tout de suite ») :
// - parole 1, 320 → 1600 : envoyée à 1878 (réponse 1), confirmée à 2272 ; phrase 1 coupée à sa virgule comme le
//   fait le serveur, « Demain matin il fera frais, » reçue 2278, son 2428, 27 car. × 60 = 1620 ms, 5 mots.
// - « arrête », parole 2, 3136 → 3736 : tenue 3136 + 384 = 3520 → suspendue, son arrêté 1092 ms après son début :
//   1092 / 1620 = 0,674 → 3 mots sur 5 (de 972 à 1296 ms : 120 ms de marge avant, 204 après). Dernière trame
//   3712 ; pause 3872 → essai, transcrite 4022 → pour elle, envoyée (réponse 2) ; fin 3712 + 704 = 4416 → confirmée → coupée,
//   « Demain matin il » au serveur, silence coupé.
import type { Scenario } from '../scenario.ts';

export default {
  nom: 'arrete-net',
  source:
    "« arrête » ou « non » pendant une longue réponse : elle se tait pour de bon ; / la couper en cours de phrase (tout de suite, puis en fin de phrase) et vérifier ce qu'elle dit avoir été entendue",
  apport: "les mots entendus calculés sur un son qui dure, à l'instant daté de la coupure",
  mecanismes: ['ecoute', 'essai', 'transcription', 'filtre', 'suspension', 'coupure', 'serveur', 'voix'],
  personne: [
    { a: 320, dit: 'Raconte-moi la journée de demain', duree: 1280 },
    // 3136 − 2428, le premier son de la réponse 1
    { apres: { joue: 1, ms: 708 }, dit: 'Arrête', duree: 600 },
  ],
  modele: {
    reponses: [
      { si: 'arrete', phrases: ["D'accord."] },
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
      id: 'son-arrete',
      niveau: 'exact',
      mecanisme: 'suspension',
      dit: 'son son est arrêté à la tenue de « arrête »',
      evenement: 'son',
      ou: { reponse: 1, valeurs: { etape: 'fin', arrete: true, par: 2 } },
      depuis: { parole: 2, bord: 'debut' },
      // tenue à 384 ms du début, une trame de marge
      entre: [384, 416],
    },
    {
      id: 'sortie-arretee',
      niveau: 'exact',
      mecanisme: 'suspension',
      // `son` arrêté se lit dans la trace du Speaker, écrite même si la sortie continue : ici, la sortie elle-même.
      dit: 'la sortie se tait à la tenue de « arrête »',
      evenement: 'arrete',
      ou: { reponse: 1 },
      depuis: { parole: 2, bord: 'debut' },
      // tenue à 384 ms du début, une trame de marge ; laissé à lui-même, le son finirait à 4048 (528 ms après)
      entre: [384, 416],
    },
    {
      id: 'arret-coupure',
      niveau: 'exact',
      mecanisme: 'suspension',
      dit: "de la tenue à l'arrêt du son, rien n'attend",
      delai: 'arret_coupure',
      tour: { parole: 2 },
      // le même instant ; une trame de marge si le joueur décide la trame après son heure
      entre: [0, 32],
    },
    {
      id: 'coupee',
      niveau: 'exact',
      mecanisme: 'coupure',
      dit: 'coupée, trois mots entendus sur cinq',
      evenement: 'coupee',
      ou: { reponse: 1, valeurs: { entendu: 'Demain matin il' } },
    },
    {
      id: 'coupure-recue',
      niveau: 'exact',
      mecanisme: 'coupure',
      dit: 'le serveur reçoit les mots entendus',
      evenement: 'coupure_recue',
      ou: { reponse: 1, valeurs: { entendu: 'Demain matin il' } },
    },
    {
      id: 'silence-coupe',
      niveau: 'tous',
      mecanisme: 'voix',
      dit: 'elle se tait, coupée',
      evenement: 'silence',
      ou: { valeurs: { coupee: true } },
      depuis: { parole: 2, bord: 'debut' },
    },
    {
      id: 'pour-de-bon',
      niveau: 'tous',
      mecanisme: 'voix',
      dit: 'plus rien de la réponse 1 ne sonne',
      evenement: 'joue',
      ou: { reponse: 1 },
      // Dès le début de « arrête », plus tôt que l'arrêt du son : `son-arrete` est exact, une ancre `tous` n'y tient pas.
      depuis: { parole: 2, bord: 'debut' },
      absent: true,
    },
  ],
} satisfies Scenario;
