// Moitié serveur, hors de ce niveau : « la carte reste et elle ne la redemande pas », ce que le serveur fait de la
// coupure d'une demande qui prépare une carte.
//
// Le calcul (trames de 32 ms à partir de 0, DEFAUTS, réglages par défaut : pause 160, silence 700, tenue 400) :
// - parole 1, 320 → 1600 : dernière trame 1568 ; pause 1728 → essai ; transcrite 1878 → envoyée (réponse 1) ;
//   fin 2272 → confirmée.
// - réponse 1 : phrase d'attente reçue 1878 + 400 = 2278, synthèse → son 2428, 24 car. × 60 = 1440 → fin 3868.
//   Le poste dure 2 s, puis le second mot : le résultat serait reçu 2278 + 2000 + 400 = 4678, synthèse → 4828.
//   Le blanc : 3868 → 4828.
// - « arrête », parole 2, 3872 → 4472 : tenue 3872 + 384 = 4256, dans le blanc → suspendue, aucun son à arrêter.
//   Dernière trame 4448 ; pause 4608 → essai, transcrite 4758 → pour elle (filtre coupé), envoyée (réponse 2) ;
//   fin 4448 + 704 = 5152 → confirmée → la réponse 1 est coupée, entendu : la phrase d'attente entière.
import type { Scenario } from '../scenario.ts';

export default {
  nom: 'couper-le-blanc',
  source:
    "la couper au milieu d'une réponse longue, entre deux phrases ; / la couper pendant ce blanc, sur une demande qui prépare une carte : la carte reste et elle ne la redemande pas.",
  apport: "le blanc vient de vraies durées (poste, synthèse, son), pas d'un état posé à la main",
  mecanismes: ['ecoute', 'essai', 'transcription', 'filtre', 'suspension', 'coupure', 'serveur', 'voix'],
  personne: [
    { a: 320, dit: 'Tu peux regarder mes messages', duree: 1280 },
    // 3872 − 2428, le premier son de la réponse 1 : dans le blanc qui suit sa phrase d'attente
    { apres: { joue: 1, ms: 1444 }, dit: 'Arrête', duree: 600 },
  ],
  modele: {
    reponses: [
      { si: 'arret', phrases: ["D'accord."] },
      {
        si: 'messages',
        phrases: ['Je regarde tes messages.', 'Tu as trois nouveaux messages.'],
        poste: { apres: 1, ms: 2000 },
      },
    ],
  },
  attendus: [
    {
      id: 'suspendue',
      niveau: 'tous',
      mecanisme: 'suspension',
      dit: '« arrête » la suspend',
      evenement: 'suspendue',
      ou: { reponse: 1, valeurs: { par: 2 } },
      depuis: { parole: 2, bord: 'debut' },
    },
    {
      id: 'suspendue-a-la-tenue',
      niveau: 'exact',
      mecanisme: 'suspension',
      dit: 'suspendue à la tenue de « arrête »',
      evenement: 'suspendue',
      ou: { reponse: 1 },
      depuis: { parole: 2, bord: 'debut' },
      // tenue à 384 ms du début, une trame de marge
      entre: [384, 416],
    },
    {
      id: 'dans-le-blanc',
      niveau: 'exact',
      mecanisme: 'suspension',
      dit: "dans le blanc : aucun son n'est arrêté",
      evenement: 'son',
      ou: { reponse: 1, valeurs: { arrete: true } },
      absent: true,
    },
    {
      id: 'coupee',
      niveau: 'tous',
      mecanisme: 'coupure',
      dit: "coupée, la phrase d'attente entendue entière",
      evenement: 'coupee',
      ou: { reponse: 1, valeurs: { entendu: 'Je regarde tes messages.' } },
    },
    {
      id: 'coupure-recue',
      niveau: 'tous',
      mecanisme: 'coupure',
      dit: 'le serveur reçoit ce qui a été entendu',
      evenement: 'coupure_recue',
      ou: { reponse: 1, valeurs: { entendu: 'Je regarde tes messages.' } },
    },
    {
      id: 'resultat-muet',
      niveau: 'tous',
      mecanisme: 'voix',
      dit: 'le résultat ne sonne pas',
      evenement: 'joue',
      ou: { reponse: 1, valeurs: { texte: 'Tu as trois nouveaux messages.' } },
      absent: true,
    },
  ],
} satisfies Scenario;
