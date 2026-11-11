// Moitié serveur : aucune.
//
// Le calcul (trames de 32 ms à partir de 0, DEFAUTS, réglages par défaut : pause 160, silence 700, tenue 400,
// coupure « tout de suite ») :
// - parole 1, 320 → 1600 : envoyée à 1878 (réponse 1), confirmée à 2272 ; reçue 2278, coupée à sa première virgule
//   comme le fait le serveur : phrase 1 « Demain matin il fera frais, » son 2428, 27 car. × 60 = 1620 ms ; phrase 2
//   « puis le soleil… », son 4048, 55 car. × 60 = 3300 ms, 11 mots.
// - « non », parole 2, 4768 → 5068 (300 ms) : 10 trames, 320 ms d'affilée < 384 : aucune tenue, elle parle encore.
//   Dernière trame 5056 ; pause → essai → pour elle (pas encore confirmé) ; fin 5056 + 704 = 5760 → confirmée : la
//   coupure part là, pas au verdict — l'essai à la pause n'est pour elle qu'à la fin de la phrase. Son arrêté
//   5760 − 4048 = 1712 ms après le début de la phrase 2 : 0,519 → 5 mots sur 11, après les 5 de la phrase 1.
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
    // 4768 − 4048, le premier son de la phrase 2, la longue ; 4768 sur une trame, comme 3136 au calcul d'avant
    { apres: { joue: 1, phrase: 2, ms: 720 }, dit: 'Non', duree: 300 },
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
      // fin à 5056 + 704 = 5760, soit 692 ms après le bord 5068 ; une trame de marge
      entre: [692, 724],
    },
    {
      id: 'sortie-arretee',
      niveau: 'exact',
      mecanisme: 'suspension',
      // `son` arrêté se lit dans la trace du Speaker, écrite même si la sortie continue : ici, la sortie elle-même.
      dit: 'la sortie se tait à la fin de « non »',
      evenement: 'arrete',
      ou: { reponse: 1 },
      depuis: { parole: 2, bord: 'fin' },
      // fin à 5760, soit 692 ms après le bord 5068, une trame de marge ; le son finirait à 7348 sinon
      entre: [692, 724],
    },
    {
      id: 'coupee',
      niveau: 'exact',
      mecanisme: 'coupure',
      dit: 'coupée, la phrase 1 et cinq mots sur onze de la phrase 2 entendus',
      evenement: 'coupee',
      ou: { reponse: 1, valeurs: { entendu: 'Demain matin il fera frais, puis le soleil reviendra vers' } },
    },
    {
      id: 'coupure-recue',
      niveau: 'exact',
      mecanisme: 'coupure',
      dit: 'le serveur reçoit les mots entendus',
      evenement: 'coupure_recue',
      ou: { reponse: 1, valeurs: { entendu: 'Demain matin il fera frais, puis le soleil reviendra vers' } },
    },
    {
      id: 'pour-de-bon',
      niveau: 'tous',
      mecanisme: 'voix',
      dit: 'plus rien de la réponse 1 ne sonne',
      evenement: 'joue',
      ou: { reponse: 1 },
      // Dès le début de « non », plus tôt que l'arrêt du son : `son-arrete` est exact, une ancre `tous` n'y tient pas.
      depuis: { parole: 2, bord: 'debut' },
      absent: true,
    },
  ],
} satisfies Scenario;
