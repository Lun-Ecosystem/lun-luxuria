// Moitié serveur : aucune. Hors de ce niveau : le vrai temps du modèle de voix, au desktop (étape 5).
//
// Le calcul (trames de 32 ms à partir de 0, DEFAUTS, l'essai coupé ; silence 700), le modèle de voix à 40 ms :
// - chaque trame est décidée après la précédente, 40 ms chacune : la trame k (à 32 k) est décidée à 40 (k + 1),
//   soit 8 k + 40 ms de retard, qui croît pendant toute la partie.
// - parole 1, 320 → 1920 : dernière trame de voix 1888 (k = 59) ; la fin est la trame 59 + 22 = 81 (2592),
//   décidée à 40 × 82 = 3280. attente_fin = 3280 − 1888 = 1392 = 704 + 688.
// - transcrite 3430, phrase reçue 3830, premier son 3980 : blanc_de_tour = 3980 − 1888 = 2092 = 1392 + 700.
// Si le joueur commence ses trames à 32, le retard perd 8 ms (1384, 2084) : la marge le couvre.
import type { Scenario } from '../scenario.ts';

export default {
  nom: 'delai-modele-lent',
  source: 'le délai de réponse avec 0,7 s de silence de fin, sur vingt tours, comparé aux 3,4 s du 10/11 ;',
  apport: "un modèle de voix plus lent qu'une trame accumule son retard, et ce retard sort dans attente_fin",
  mecanismes: ['ecoute', 'transcription', 'filtre', 'serveur', 'voix'],
  reglages: { endOfSpeech: { speculate: false } },
  modeleMs: 40,
  personne: [{ a: 320, dit: 'Tu peux me lire la liste des courses', duree: 1600 }],
  modele: { reponses: [{ phrases: ['Il reste du pain, des pommes et du lait.'] }] },
  attendus: [
    {
      id: 'attente-fin',
      niveau: 'exact',
      mecanisme: 'ecoute',
      dit: 'le retard du modèle de voix sort dans attente_fin',
      delai: 'attente_fin',
      tour: { parole: 1 },
      // 704 + 688 = 1392, une trame de marge de chaque côté
      entre: [1360, 1424],
    },
    {
      id: 'blanc-de-tour',
      niveau: 'exact',
      mecanisme: 'voix',
      dit: 'le blanc garde tout ce retard, et rien de plus',
      delai: 'blanc_de_tour',
      tour: { parole: 1 },
      // 1392 + 150 + 400 + 150 = 2092, une trame de marge de chaque côté
      entre: [2060, 2124],
    },
  ],
} satisfies Scenario;
