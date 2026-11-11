// Moitié serveur : aucune. Hors de ce niveau : les vingt tours et les vrais délais, au desktop (étape 5).
//
// Le calcul (trames de 32 ms à partir de 0, DEFAUTS, l'essai en service ; pause 160, silence 700) :
// - parole 1, 320 → 1920, un trou de 300 ms à 960 → 1260 : dernière trame avant le trou 928 ; pause 928 + 160 =
//   1088 → essai 1 ; transcrite 1238 → envoyé ; la voix revient à 1280 → reprise → essai 1 retiré.
// - dernière trame de voix 1888 ; pause 2048 → essai 2 ; transcrite 2198 → envoyé, tenu ; fin 1888 + 704 = 2592
//   → confirmé, relâché ; phrase reçue 2198 + 400 = 2598 ; synthèse → premier son 2748.
//   attente_fin = 704 ; blanc_de_tour = 2748 − 1888 = 860 = 160 + 150 + 400 + 150, contre 1404 sans l'essai
//   (delai-de-reponse). Si le premier mot se compte depuis le numéro (20 ms), 880 : dans la marge.
import type { Scenario } from '../scenario.ts';

export default {
  nom: 'delai-a-l-essai',
  source: 'le délai de réponse avec 0,7 s de silence de fin, sur vingt tours, comparé aux 3,4 s du 10/11 ;',
  apport:
    "l'essai à la pause raccourcit le blanc de tout le silence de fin moins une pause, par la vraie écoute",
  mecanismes: ['ecoute', 'essai', 'transcription', 'filtre', 'serveur', 'voix'],
  personne: [
    {
      a: 320,
      dit: 'Tu peux me lire la liste des courses',
      duree: 1600,
      trous: [{ a: 640, duree: 300 }],
    },
  ],
  modele: { reponses: [{ phrases: ['Il reste du pain, des pommes et du lait.'] }] },
  attendus: [
    {
      id: 'essai-retire',
      niveau: 'tous',
      mecanisme: 'essai',
      dit: "l'essai au trou est retiré quand la voix revient",
      evenement: 'retiree',
      ou: { parole: 1, essai: 1 },
    },
    {
      id: 'essai-confirme',
      niveau: 'tous',
      mecanisme: 'essai',
      dit: "l'essai à la dernière pause est confirmé par la fin",
      evenement: 'confirmee',
      ou: { parole: 1, essai: 2 },
    },
    {
      id: 'attente-fin',
      niveau: 'exact',
      mecanisme: 'ecoute',
      dit: "la fin tombe 0,7 s après la dernière voix, à une trame près, l'essai n'y change rien",
      delai: 'attente_fin',
      tour: { parole: 1 },
      // 22 trames × 32 = 704
      entre: [700, 736],
    },
    {
      id: 'blanc-de-tour',
      niveau: 'exact',
      mecanisme: 'voix',
      dit: "le blanc à l'essai : une pause, la transcription, le premier mot, la synthèse",
      delai: 'blanc_de_tour',
      tour: { parole: 1 },
      // 160 + 150 + 400 + 150 = 860, une trame de marge
      entre: [860, 892],
    },
  ],
} satisfies Scenario;
