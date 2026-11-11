// Moitié serveur, hors de ce niveau : « sans redire la phrase », ce que le serveur fait de la phrase d'attente quand
// le résultat arrive ; et les vrais délais du poste (`delegations.duration_ms`), au desktop.
//
// Le calcul (trames de 32 ms à partir de 0, DEFAUTS, réglages par défaut : pause 160, silence 700) :
// - parole 1, 320 → 1280 : dernière trame 1248 ; pause 1408 → essai ; transcrite 1558 → envoyée (réponse 1) ;
//   fin 1952 → confirmée.
// - phrase d'attente reçue 1558 + 400 = 1958, synthèse → son 2108, 21 car. × 60 = 1260 → arrêt 3368.
// - le poste dure 2,5 s : le résultat est reçu 1958 + 300 + 2500 = 4758, synthèse → son 4908.
//   Le blanc entendu : 4908 − 3368 = 1540 = 300 + 2500 + 150 − 1260 (l'écart, le poste, la synthèse, moins le son
//   de la phrase d'attente). Si le faux serveur compte le poste à la place de l'écart entre phrases, 1240 : hors de
//   la borne, à relire avec le joueur.
import type { Scenario } from '../scenario.ts';

export default {
  nom: 'phrase-attente',
  source:
    "« j'ai des mails ? » à la voix : elle dit d'abord ce qu'elle fait, puis le résultat, sans redire la phrase ; / le blanc entre la phrase et le résultat, sur cinq demandes ; les durées sont dans la base (`delegations.duration_ms`) ;",
  apport: 'le blanc que CrOliX entendrait, tiré du déroulé : vraies durées de poste, de synthèse et de son',
  mecanismes: ['ecoute', 'essai', 'transcription', 'filtre', 'serveur', 'voix'],
  personne: [{ a: 320, dit: "J'ai des mails ?", duree: 960 }],
  modele: {
    reponses: [
      {
        phrases: ['Je regarde tes mails.', 'Tu as deux nouveaux messages.'],
        poste: { apres: 1, ms: 2500 },
      },
    ],
  },
  attendus: [
    {
      id: 'attente-joue',
      niveau: 'tous',
      mecanisme: 'voix',
      dit: "elle dit d'abord ce qu'elle fait",
      evenement: 'joue',
      ou: { reponse: 1, valeurs: { texte: 'Je regarde tes mails.' } },
    },
    {
      id: 'attente-finie',
      niveau: 'tous',
      mecanisme: 'voix',
      dit: "la phrase d'attente finit",
      evenement: 'arrete',
      ou: { reponse: 1 },
      depuis: { attendu: 'attente-joue' },
    },
    {
      id: 'resultat-joue',
      niveau: 'tous',
      mecanisme: 'voix',
      dit: 'puis le résultat',
      evenement: 'joue',
      ou: { reponse: 1, valeurs: { texte: 'Tu as deux nouveaux messages.' } },
      depuis: { attendu: 'attente-finie' },
    },
    {
      id: 'blanc',
      niveau: 'exact',
      mecanisme: 'voix',
      dit: 'le blanc entre la phrase et le résultat',
      evenement: 'joue',
      ou: { reponse: 1, valeurs: { texte: 'Tu as deux nouveaux messages.' } },
      depuis: { attendu: 'attente-finie' },
      // 300 + 2500 + 150 − 1260 = 1540, une trame de marge
      entre: [1540, 1572],
    },
    {
      id: 'poste',
      niveau: 'exact',
      mecanisme: 'serveur',
      dit: 'le délai du poste, lu dans les durées du serveur',
      delai: 'poste',
      tour: { reponse: 1 },
      // postMs du faux serveur : le poste du scénario
      entre: [2500, 2500],
    },
  ],
} satisfies Scenario;
