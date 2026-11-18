// Moitié serveur : une réponse qui finit en erreur sans un mot (le plafond, par exemple). Les briques fausses disent sa
// fin de parole avant son erreur : la voie sans fin de parole (Q7) n'est pas jouée ici, seulement ce qui l'entoure.
//
// Le calcul (trames de 32 ms à partir de 0, DEFAUTS ; pause 160, silence 700) :
// - parole 1, 320 → 1600 : dernière trame 1568 ; pause 1728 → essai, transcrite 1878 → envoyée (réponse 1) ; fin 2272
//   → confirmée. Réponse reçue à 1898, sa fin de parole puis son erreur à 1878 + 400 = 2278.
// - parole 2, 3200 → 3840 : dernière trame 3808 ; pause 3968 → essai, transcrite 4118 → envoyée (réponse 2) ; fin
//   4512 → confirmée. Sa phrase reçue à 4518, synthèse → premier son à 4668.
// - rien n'est montré pour la réponse 1 : aucun `silence` de la voix entre son erreur et le premier son de la 2.
import type { Scenario } from '../scenario.ts';

export default {
  nom: 'reponse-en-erreur',
  source:
    'aucun point de la liste : une réponse qui finit en erreur sans un mot, puis une question (lun-luxuria#81, Q7)',
  apport:
    'une réponse en erreur n’éteint pas la voix à vide et ne bloque pas la question suivante : elle est dite une fois, la réponse 2 sonne',
  mecanismes: ['ecoute', 'essai', 'transcription', 'filtre', 'serveur', 'voix'],
  personne: [
    { a: 320, dit: 'Raconte-moi la journée de demain', duree: 1280 },
    { a: 3200, dit: 'Et samedi ?', duree: 640 },
  ],
  modele: {
    reponses: [
      { si: 'demain', phrases: [], erreur: 'Plafond atteint' },
      { si: 'samedi', phrases: ['Samedi sera ensoleillé.'] },
    ],
  },
  attendus: [
    {
      id: 'ecrite',
      niveau: 'tous',
      mecanisme: 'serveur',
      dit: 'la réponse 1, en erreur, est écrite sans réponse',
      evenement: 'sans_reponse',
      ou: { reponse: 1 },
    },
    {
      id: 'rien-ne-sonne',
      niveau: 'tous',
      mecanisme: 'voix',
      dit: 'rien ne sonne pour la réponse 1',
      evenement: 'premier_son',
      ou: { reponse: 1 },
      absent: true,
    },
    {
      id: 'pas-de-silence-a-vide',
      niveau: 'exact',
      mecanisme: 'voix',
      dit: 'elle ne retombe pas dans le silence pour une réponse qui n’a rien montré',
      evenement: 'silence',
      depuis: { attendu: 'ecrite' },
      // jusqu'au premier son de la réponse 2 : 4668 − 2278, une trame de marge
      entre: [0, 2360],
      absent: true,
    },
    {
      id: 'reponse-2',
      niveau: 'tous',
      mecanisme: 'voix',
      dit: 'la réponse à la question suivante sonne',
      evenement: 'premier_son',
      ou: { reponse: 2 },
    },
  ],
} satisfies Scenario;
