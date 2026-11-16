// Moitié serveur : aucune, rien ne part. Hors de ce niveau : « réfléchit », que le joueur ne voit pas ; la requête
// coupée, que le faux ne voit pas ; un vrai service lent, à la main.
//
// Le calcul (trames de 32 ms à partir de 0, DEFAUTS ; scène : filtre coupé ; pause 160, silence 700, tenue 400) :
// - elle parle seule à 1000 (pourquoi : spontaneous), synthèse → son 1150 ; 52 car. × 60 = 3120 ms.
// - parole 1, 2016 → 3296 : tenue 2400 → suspendue. Pause 3424 → essai, sa transcription prend 25 s ; fin 3968 →
//   confirmée.
// - la garde de transcription, 20 s après l'essai : 23424 → transcrite en échec, sans réponse ; elle reprend, son
//   23574 → 26694.
// - la transcription répond à 3424 + 25000 = 28424, après la garde : rien n'en est jugé, rien ne part.
import type { Scenario } from '../scenario.ts';

export default {
  nom: 'transcription-lente',
  source:
    'aucun point de la liste : une transcription qui ne vient pas laisse la page attendre sans fin, sa voix suspendue (audit du 12/11, I6)',
  apport:
    'une transcription qui répond après sa garde ne compte plus : rien n’est jugé, rien ne part, la phrase n’est sans réponse qu’une fois',
  mecanismes: ['ecoute', 'essai', 'transcription', 'suspension', 'voix'],
  personne: [{ a: 2016, dit: 'Attends une seconde', duree: 1280, transcriptionMs: 25_000 }],
  modele: {
    parle: [
      { a: 1000, pourquoi: 'spontaneous', phrases: ['Les pêcheurs rangent les filets sur le quai mouillé.'] },
    ],
    reponses: [{ phrases: ['Oui ?'] }],
  },
  jusqua: 32_000,
  attendus: [
    {
      id: 'essai',
      niveau: 'tous',
      mecanisme: 'essai',
      dit: 'la parole 1 est essayée à sa pause',
      evenement: 'essai',
      ou: { parole: 1 },
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
      id: 'pas-de-second-sans-reponse',
      niveau: 'tous',
      mecanisme: 'transcription',
      dit: 'la transcription tardive ne la redit pas sans réponse',
      evenement: 'sans_reponse',
      depuis: { attendu: 'sans-reponse' },
      // juste après le premier, jusqu'à la fin de la partie
      entre: [1, 10_000],
      absent: true,
    },
    {
      id: 'aucun-verdict',
      niveau: 'tous',
      mecanisme: 'filtre',
      dit: 'la transcription tardive n’est pas jugée',
      evenement: 'verdict',
      absent: true,
    },
    {
      id: 'rien-ne-part',
      niveau: 'tous',
      mecanisme: 'serveur',
      dit: 'rien ne part au serveur',
      evenement: 'envoi_recu',
      absent: true,
    },
  ],
} satisfies Scenario;
