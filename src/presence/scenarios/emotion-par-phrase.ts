// Le critère 5 du plan « l'émotion par phrase » (lun-luxuria#107). Le faux modèle étiquette ses phrases comme le cerveau
// le lira : `{id}` en tête. Dans la chaîne, le cerveau les retire du texte et publie l'émotion sur `speech` ; la sonde lit
// ce que la session tient au premier son de chaque phrase (`emotionsLues`). Au niveau exact, seul le texte propre compte.
// La dernière étiquette est hors liste : le cerveau la retire et la dit neutre (au niveau exact, le faux serveur la publie telle quelle). Une phrase neutre est étiquetée `{neutre}` : sans étiquette, elle garderait celle d'avant (décision 2 du plan).
import type { Scenario } from '../scenario.ts';

export default {
  nom: 'emotion-par-phrase',
  source: "l'émotion de chaque phrase, tenue par la session pendant qu'elle la dit ;",
  apport:
    "la session tient l'émotion de la phrase lue, rien pour le neutre ni pour une étiquette mal formée, et ni accolade ni identifiant à l'écran ou à la voix",
  mecanismes: ['ecoute', 'essai', 'transcription', 'filtre', 'serveur', 'voix'],
  personne: [{ a: 320, dit: 'Dis-moi quelque chose', duree: 1280 }],
  modele: {
    reponses: [
      {
        phrases: [
          '{seche} Il est tard.',
          '{douce} Va te reposer.',
          '{neutre} Bonne nuit.',
          '{joyeuse} À demain.',
        ],
      },
    ],
  },
  emotionsLues: [
    { texte: 'Il est tard.', emotion: 'seche' },
    { texte: 'Va te reposer.', emotion: 'douce' },
    { texte: 'Bonne nuit.', emotion: undefined },
    { texte: 'À demain.', emotion: undefined },
  ],
  attendus: ['Il est tard.', 'Va te reposer.', 'Bonne nuit.', 'À demain.'].map((texte, i) => ({
    id: `joue-${i + 1}`,
    niveau: 'tous' as const,
    mecanisme: 'voix' as const,
    dit: `la phrase ${i + 1} sonne, sans étiquette`,
    evenement: 'joue' as const,
    ou: { reponse: 1, valeurs: { texte } },
  })),
} satisfies Scenario;
