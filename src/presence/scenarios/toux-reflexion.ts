// Moitié serveur : aucune. L'aparté pendant qu'elle réfléchit est sorti : conversation.test.ts:435 et :515 le
// prouvent déjà.
//
// Le calcul (trames de 32 ms à partir de 0, DEFAUTS, réglages par défaut : pause 160, silence 700, tenue 400) :
// - parole 1, 320 → 1600 : dernière trame 1568 ; pause 1728 → essai ; transcrite 1878 → envoyée (réponse 1) ;
//   fin 2272 → confirmée. Le modèle met 3 s : phrase reçue 1878 + 3000 = 4878.
// - la toux, parole 2, 2560 → 3010 (450 ms : 15 trames de voix, 480 ms ≥ 250, ce n'est pas un `bruit` de
//   l'écoute) : tenue 2560 + 384 = 2944 → retenue de la réponse 1 ; dernière trame 3008 ; pause 3168 → essai,
//   transcrite vide 3318 → verdict `bruit` ; fin 3008 + 704 = 3712 → sans réponse → relâchée.
// - la réponse 1 : 4878, synthèse → premier son 5028.
import type { Scenario } from '../scenario.ts';

export default {
  nom: 'toux-reflexion',
  source:
    "une toux, ou une phrase qui n'est pas pour elle, pendant qu'elle réfléchit : sa réponse sort quand même ;",
  apport:
    "une toux de 450 ms n'est pas un bruit de l'écoute mais une phrase transcrite vide, qui retient puis relâche",
  mecanismes: ['ecoute', 'essai', 'transcription', 'filtre', 'retenue', 'serveur', 'voix'],
  personne: [
    { a: 320, dit: 'Quel temps fera-t-il demain', duree: 1280 },
    { a: 2560, dit: '(toux)', duree: 450, entendu: '' },
  ],
  modele: { reponses: [{ premierMotMs: 3000, phrases: ['Demain, il fera doux et sec.'] }] },
  attendus: [
    {
      id: 'retenue',
      niveau: 'exact',
      mecanisme: 'retenue',
      dit: 'la toux retient la réponse 1 à sa tenue',
      evenement: 'retenue',
      ou: { reponse: 1, valeurs: { par: 2 } },
      depuis: { parole: 2, bord: 'debut' },
      // tenue à 384 ms du début de la toux, une trame de marge
      entre: [384, 416],
    },
    {
      id: 'pas-un-bruit',
      niveau: 'exact',
      mecanisme: 'ecoute',
      dit: "450 ms de voix : l'écoute en fait une phrase, pas un bruit",
      evenement: 'bruit',
      ou: { parole: 2 },
      absent: true,
    },
    {
      id: 'verdict-bruit',
      niveau: 'tous',
      mecanisme: 'filtre',
      dit: 'la toux transcrite vide est jugée bruit',
      evenement: 'verdict',
      ou: { parole: 2, valeurs: { resultat: 'bruit' } },
    },
    {
      id: 'relachee',
      niveau: 'tous',
      mecanisme: 'retenue',
      dit: 'la réponse 1 est relâchée',
      evenement: 'relachee',
      ou: { reponse: 1, valeurs: { par: 2 } },
    },
    {
      id: 'relachee-a-la-fin',
      niveau: 'exact',
      mecanisme: 'retenue',
      dit: 'relâchée à la fin de la toux',
      evenement: 'relachee',
      ou: { reponse: 1 },
      depuis: { parole: 2, bord: 'fin' },
      // fin à 3008 + 704 = 3712, soit 702 ms après le bord 3010 ; une trame de marge de chaque côté
      entre: [670, 734],
    },
    {
      id: 'elle-repond',
      niveau: 'tous',
      mecanisme: 'voix',
      dit: 'la réponse 1 sonne',
      evenement: 'premier_son',
      ou: { reponse: 1 },
    },
    {
      id: 'pas-de-coupure',
      niveau: 'tous',
      mecanisme: 'coupure',
      dit: 'rien ne part au serveur comme coupure',
      evenement: 'coupure_recue',
      absent: true,
    },
  ],
} satisfies Scenario;
