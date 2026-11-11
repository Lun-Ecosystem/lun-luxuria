// Moitié serveur, hors de ce niveau : « une seule réponse, qui a lu les deux », le contexte que le serveur donne au
// modèle pour la seconde phrase.
//
// Le calcul (trames de 32 ms à partir de 0, DEFAUTS, réglages par défaut : pause 160, silence 700, tenue 400) :
// - parole 1, 320 → 1600 : dernière trame de voix 1568 ; pause 1728 → essai 1 ; transcrite 1878 → envoyée
//   (réponse 1) ; fin 1568 + 704 = 2272 → confirmée. Le modèle met 4 s : phrase reçue 1878 + 4000 = 5878.
// - parole 2, 4608 → 6656 : tenue 4608 + 384 = 4992, elle se tait encore → retenue de la réponse 1.
//   La phrase de la réponse 1 arrive à 5878, pendant que la parole 2 se tient (1270 ms après son début).
//   Dernière trame 6624 ; pause 6784 → essai, transcrite 6934 → pour elle (filtre coupé en scène), envoyée
//   (réponse 2) ; fin 6624 + 704 = 7328 → confirmée → oubliée la réponse 1, coupure à mots vides.
// - réponse 2 : 6934 + 400 = 7334, synthèse → premier son 7484.
import type { Scenario } from '../scenario.ts';

export default {
  nom: 'deux-phrases',
  source:
    "deux phrases à trois secondes d'écart pendant qu'elle réfléchit : une seule réponse, qui a lu les deux ;",
  apport:
    'la phrase du serveur arrive pendant que la parole 2 se tient, à un instant daté, pas avant ni après',
  mecanismes: ['ecoute', 'essai', 'transcription', 'filtre', 'retenue', 'coupure', 'serveur', 'voix'],
  personne: [
    { a: 320, dit: 'Tu peux me rappeler le film de ce soir', duree: 1280 },
    // 4608 − 1878, l'envoi de la parole 1 : pendant qu'elle réfléchit
    { apres: { envoi: 1, ms: 2730 }, dit: 'Et aussi la météo de demain', duree: 2048 },
  ],
  modele: {
    reponses: [
      {
        si: 'film',
        premierMotMs: 4000,
        phrases: ['Ce soir, il y a un vieux western à vingt et une heures.'],
      },
      { si: 'meteo', phrases: ['Le film est à vingt et une heures, et demain il fera beau.'] },
    ],
  },
  attendus: [
    {
      id: 'retenue',
      niveau: 'exact',
      mecanisme: 'retenue',
      dit: 'la réponse 1 est retenue à la tenue de la parole 2',
      evenement: 'retenue',
      ou: { reponse: 1, valeurs: { par: 2 } },
      depuis: { parole: 2, bord: 'debut' },
      // tenue à 384 ms du début (12 trames de voix après la première), une trame de marge
      entre: [384, 416],
    },
    {
      id: 'phrase-pendant',
      niveau: 'exact',
      mecanisme: 'serveur',
      dit: 'la phrase de la réponse 1 arrive pendant que la parole 2 se tient',
      evenement: 'phrase_recue',
      ou: { reponse: 1 },
      depuis: { parole: 2, bord: 'debut' },
      // 1270 ms prévus ; la fenêtre dit seulement : après la tenue (384), avant la fin de la parole (2048)
      entre: [384, 2048],
    },
    {
      id: 'oubliee',
      niveau: 'tous',
      mecanisme: 'retenue',
      dit: 'la réponse 1 est oubliée',
      evenement: 'oubliee',
      ou: { reponse: 1 },
    },
    {
      id: 'coupure-vide',
      niveau: 'tous',
      mecanisme: 'coupure',
      dit: 'le serveur reçoit la coupure de la réponse 1, sans mot entendu',
      evenement: 'coupure_recue',
      ou: { reponse: 1, valeurs: { entendu: '' } },
    },
    {
      id: 'reponse-1-muette',
      niveau: 'tous',
      mecanisme: 'voix',
      dit: 'rien de la réponse 1 ne sonne',
      evenement: 'joue',
      ou: { reponse: 1 },
      absent: true,
    },
    {
      id: 'pas-de-premier-son-1',
      niveau: 'tous',
      mecanisme: 'voix',
      dit: 'aucun premier son pour la réponse 1',
      evenement: 'premier_son',
      ou: { reponse: 1 },
      absent: true,
    },
    {
      id: 'premier-son-2',
      niveau: 'tous',
      mecanisme: 'voix',
      dit: 'la réponse 2 sonne',
      evenement: 'premier_son',
      ou: { reponse: 2 },
    },
  ],
} satisfies Scenario;
