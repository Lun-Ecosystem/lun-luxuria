// Moitié serveur : aucune, rien ne part. Hors de ce niveau : « réfléchit », que le joueur ne voit pas (le test de
// `conversation.test.ts` le tient) ; la requête coupée, que le faux ne voit pas ; un vrai service figé, à la main.
//
// Le calcul (trames de 32 ms à partir de 0, DEFAUTS ; scène : filtre coupé ; pause 160, silence 700, tenue 400) :
// - elle parle seule à 1000 (pourquoi : spontaneous), synthèse → son 1150 ; 52 car. × 60 = 3120 ms.
// - parole 1, 2016 → 3296 : tenue 2016 + 384 = 2400 → suspendue, son arrêté. Dernière trame 3264 ; pause 3424 →
//   essai, sa transcription ne répond pas ; fin 3264 + 704 = 3968 → confirmée.
// - la garde de transcription, 20 s après l'essai : 23424 → transcrite en échec, sans réponse ; plus rien n'attend
//   la phrase, elle reprend : sa phrase redite, synthèse → son 23574, jusqu'à 26694.
import type { Scenario } from '../scenario.ts';

export default {
  nom: 'transcription-figee',
  source:
    'aucun point de la liste : une transcription qui ne vient pas laisse la page attendre sans fin, sa voix suspendue (audit du 12/11, I6)',
  apport:
    'une transcription qui ne répond jamais finit à sa garde, comme une transcription en échec : sans réponse, et elle reprend',
  mecanismes: ['ecoute', 'essai', 'transcription', 'suspension', 'voix'],
  personne: [{ a: 2016, dit: 'Attends une seconde', duree: 1280, transcriptionMs: 600_000 }],
  modele: {
    parle: [
      { a: 1000, pourquoi: 'spontaneous', phrases: ['Les pêcheurs rangent les filets sur le quai mouillé.'] },
    ],
  },
  jusqua: 30_000,
  attendus: [
    {
      id: 'suspendue',
      niveau: 'tous',
      mecanisme: 'suspension',
      dit: 'la parole 1 la suspend',
      evenement: 'suspendue',
      ou: { parle: 1 },
    },
    {
      id: 'essai',
      niveau: 'tous',
      mecanisme: 'essai',
      dit: 'la parole 1 est essayée à sa pause',
      evenement: 'essai',
      ou: { parole: 1 },
    },
    {
      id: 'echec',
      niveau: 'tous',
      mecanisme: 'transcription',
      dit: 'sa transcription finit en échec',
      evenement: 'transcrite',
      ou: { parole: 1, valeurs: { echec: true } },
    },
    {
      id: 'echec-a-la-garde',
      niveau: 'exact',
      mecanisme: 'transcription',
      dit: 'l’échec vient à la garde de transcription',
      evenement: 'transcrite',
      ou: { parole: 1, valeurs: { echec: true } },
      depuis: { attendu: 'essai' },
      // la garde, 20 s après l'essai
      entre: [20_000, 20_000],
    },
    {
      id: 'sans-reponse',
      niveau: 'tous',
      mecanisme: 'transcription',
      dit: 'la phrase est sans réponse',
      evenement: 'sans_reponse',
      ou: { parole: 1 },
    },
    {
      id: 'reprise',
      niveau: 'tous',
      mecanisme: 'suspension',
      dit: 'plus rien n’attend la phrase : elle reprend',
      evenement: 'reprise_voix',
      ou: { parle: 1 },
      depuis: { attendu: 'echec' },
    },
  ],
} satisfies Scenario;
