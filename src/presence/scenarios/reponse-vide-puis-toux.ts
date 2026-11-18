// Moitié serveur : une réponse sans un mot et sans erreur. Le tour de sa voix est fini et sorti de la file ; jamais
// entendue, elle reste celle qu'une toux retient. Sans la mémoire des tours finis, la retenue recrée ce tour, la
// relâche le laisse sans fin en tête de file, et plus rien ne sonne derrière.
//
// Le calcul (trames de 32 ms à partir de 0, DEFAUTS ; pause 160, silence 700, tenue 400) :
// - parole 1, 320 → 1600 : dernière trame 1568 ; pause 1728 → essai, transcrite 1878 → envoyée (réponse 1) ; fin
//   2272 → confirmée. Sa fin de parole à 1878 + 400 = 2278, sans un mot : son tour sort de la file.
// - la toux, parole 2, 3200 → 3650 (450 ms, comme `toux-reflexion` : une phrase transcrite vide, pas un `bruit` de
//   l'écoute) : tenue 3200 + 384 = 3584 → retenue de la réponse 1 ; dernière trame 3648 ; fin 3648 + 704 = 4352 →
//   sans réponse → relâchée.
// - sa parole spontanée à 6000, synthèse → premier son 6150.
import type { Scenario } from '../scenario.ts';

export default {
  nom: 'reponse-vide-puis-toux',
  source:
    'aucun point de la liste : une réponse vide, puis une toux qui la retient et la relâche, bloquait sa voix (lun-luxuria#95, relecture de la tâche 5)',
  apport:
    'un tour fini ne se recrée pas : la toux qui retient et relâche une réponse vide ne bloque pas la file, sa parole suivante sonne',
  mecanismes: ['ecoute', 'essai', 'transcription', 'filtre', 'retenue', 'serveur', 'voix'],
  personne: [
    { a: 320, dit: 'Raconte-moi la journée de demain', duree: 1280 },
    { a: 3200, dit: '(toux)', duree: 450, entendu: '' },
  ],
  modele: {
    reponses: [{ phrases: [] }],
    parle: [{ a: 6000, pourquoi: 'spontaneous', phrases: ['Au fait, il pleut.'] }],
  },
  attendus: [
    {
      id: 'retenue',
      niveau: 'tous',
      mecanisme: 'retenue',
      dit: 'jamais entendue, la réponse vide est retenue par la toux',
      evenement: 'retenue',
      ou: { reponse: 1, valeurs: { par: 2 } },
    },
    {
      id: 'relachee',
      niveau: 'tous',
      mecanisme: 'retenue',
      dit: 'puis relâchée à la fin de la toux',
      evenement: 'relachee',
      ou: { reponse: 1, valeurs: { par: 2 } },
    },
    {
      id: 'rien-ne-sonne',
      niveau: 'tous',
      mecanisme: 'voix',
      dit: 'rien ne sonne pour la réponse vide',
      evenement: 'premier_son',
      ou: { reponse: 1 },
      absent: true,
    },
    {
      id: 'parle-recue',
      niveau: 'tous',
      mecanisme: 'serveur',
      dit: 'sa parole spontanée arrive',
      evenement: 'phrase_recue',
      ou: { parle: 1 },
    },
    {
      id: 'elle-parle',
      niveau: 'tous',
      mecanisme: 'voix',
      dit: 'sa parole spontanée sonne : rien ne bloque la file',
      evenement: 'premier_son',
      ou: { parle: 1 },
    },
    {
      id: 'elle-parle-a-temps',
      niveau: 'exact',
      mecanisme: 'voix',
      dit: 'aussitôt sa synthèse faite',
      evenement: 'premier_son',
      ou: { parle: 1 },
      depuis: { attendu: 'parle-recue' },
      // sa synthèse, 150 ms, une trame de marge
      entre: [150, 182],
    },
  ],
} satisfies Scenario;
