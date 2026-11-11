// Moitié serveur : aucune. Hors de ce niveau : les vingt tours et les vrais délais, au desktop (étape 5).
//
// Le calcul (trames de 32 ms à partir de 0, DEFAUTS, l'essai coupé ; silence 700) :
// - parole 1, 320 → 1920 : dernière trame de voix 1888 ; 22 trames de silence (704 ≥ 700) → fin 2592.
//   attente_fin = 2592 − 1888 = 704.
// - essai final 2592 ; transcrite 2592 + 150 = 2742 → envoyée ; phrase reçue 2742 + 400 = 3142 ; synthèse →
//   premier son 3292. blanc_de_tour = 3292 − 1888 = 1404 = 704 + 150 + 400 + 150 (le premier mot se compte du
//   texte reçu, le numéro compris : `Reponse`).
import type { Scenario } from '../scenario.ts';

export default {
  nom: 'delai-de-reponse',
  source: 'le délai de réponse avec 0,7 s de silence de fin, sur vingt tours, comparé aux 3,4 s du 10/11 ;',
  apport: "le blanc passe par la vraie écoute : la page n'ajoute rien à la somme des briques qu'on ne voie",
  mecanismes: ['ecoute', 'transcription', 'filtre', 'serveur', 'voix'],
  reglages: { endOfSpeech: { speculate: false } },
  personne: [{ a: 320, dit: 'Tu peux me lire la liste des courses', duree: 1600 }],
  modele: { reponses: [{ phrases: ['Il reste du pain, des pommes et du lait.'] }] },
  attendus: [
    {
      id: 'attente-fin',
      niveau: 'exact',
      mecanisme: 'ecoute',
      dit: 'la fin tombe 0,7 s après la dernière voix, à une trame près',
      delai: 'attente_fin',
      tour: { parole: 1 },
      // 22 trames × 32 = 704 ; le silence commence entre deux trames : [700, 736]
      entre: [700, 736],
    },
    {
      id: 'blanc-de-tour',
      niveau: 'exact',
      mecanisme: 'voix',
      dit: 'le blanc est la somme des briques fausses, à une trame près',
      delai: 'blanc_de_tour',
      tour: { parole: 1 },
      // 704 + 150 (transcription) + 400 (premier mot) + 150 (synthèse) = 1404, une trame de marge
      entre: [1404, 1436],
    },
  ],
} satisfies Scenario;
