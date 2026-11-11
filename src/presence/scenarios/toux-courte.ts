// Moitié serveur : aucune.
//
// Le calcul (trames de 32 ms à partir de 0, DEFAUTS, réglages par défaut : pause 160, silence 700, tenue 400) :
// - parole 1, 320 → 1600 : envoyée à 1878 (réponse 1), confirmée à 2272 ; son de la phrase 1 2428 → 7408.
// - la toux, parole 2, 3008 → 3308 (300 ms) : 10 trames de voix, 320 ms d'affilée < 384 : aucune tenue, donc
//   aucune suspension. 320 ≥ 250 : une phrase quand même ; transcrite vide → bruit ; fin 3296 + 704 = 4000 → sans
//   réponse ; rien n'était suspendu, rien ne reprend.
import type { Scenario } from '../scenario.ts';

export default {
  nom: 'toux-courte',
  source:
    "une toux pendant qu'elle parle : elle se tait, puis redit sa phrase et continue ; compter le blanc ;",
  apport: 'le seuil de 400 ms joué en dessous : une toux de 300 ms ne la fait pas taire',
  mecanismes: ['ecoute', 'essai', 'transcription', 'filtre', 'serveur', 'voix'],
  personne: [
    { a: 320, dit: 'Raconte-moi la journée de demain', duree: 1280 },
    { a: 3008, dit: '(toux)', duree: 300, entendu: '' },
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
      id: 'pas-de-tenue',
      niveau: 'exact',
      mecanisme: 'ecoute',
      dit: '300 ms de toux ne font pas une tenue',
      evenement: 'tenue',
      ou: { parole: 2 },
      absent: true,
    },
    {
      id: 'pas-suspendue',
      niveau: 'exact',
      mecanisme: 'suspension',
      dit: 'elle ne se tait pas',
      evenement: 'suspendue',
      absent: true,
    },
    {
      id: 'son-entier',
      niveau: 'exact',
      mecanisme: 'voix',
      dit: "aucun son n'est arrêté",
      evenement: 'son',
      ou: { valeurs: { arrete: true } },
      absent: true,
    },
    {
      id: 'verdict-bruit',
      niveau: 'tous',
      mecanisme: 'filtre',
      dit: 'la toux est jugée bruit',
      evenement: 'verdict',
      ou: { parole: 2, valeurs: { resultat: 'bruit' } },
    },
  ],
} satisfies Scenario;
