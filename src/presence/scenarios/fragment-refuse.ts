// Moitié serveur : pourquoi il refuse. Hors de ce niveau : « réfléchit », que le joueur ne voit pas (le test de
// `conversation.test.ts` le tient) ; le vrai serveur, qui ne refuse pas sur commande.
//
// Le calcul (trames de 32 ms à partir de 0, DEFAUTS ; scène : filtre coupé ; pause 160, silence 700, tenue 400) :
// - elle parle seule à 1000 (pourquoi : spontaneous), synthèse → son 1150 ; 52 car. × 60 = 3120 ms.
// - parole 1, 2016 → 3296 : tenue 2016 + 384 = 2400 → suspendue, son arrêté, 1250 / 3120 → 3 mots sur 9. Dernière
//   trame 3264 ; pause 3424 → essai, transcrite 3574 → pour elle, envoyée : le serveur la reçoit et la refuse.
// - fin 3264 + 704 = 3968 → confirmée : la phrase était pour elle, elle reste coupée ; rien n'y répondra, sans
//   réponse au même instant.
// - parole 2, 6016 → 7296, elle se tait : tenue 6400, rien n'est en route, rien n'est retenu. Dernière trame 7264 ;
//   pause 7424 → essai, transcrite 7574 → envoyée (réponse 2) ; fin 7968 → confirmée ; phrase reçue 7974, premier son
//   8124.
import type { Scenario } from '../scenario.ts';

export default {
  nom: 'fragment-refuse',
  source:
    'aucun point de la liste : « réfléchit » reste allumé après un fragment que le serveur a refusé (audit du 12/11, I9)',
  apport:
    'un fragment refusé finit comme une phrase entière refusée : elle reste coupée, la phrase est sans réponse, et la parole suivante ne retient rien',
  mecanismes: ['ecoute', 'essai', 'transcription', 'filtre', 'suspension', 'coupure', 'serveur', 'voix'],
  personne: [
    { a: 2016, dit: 'Attends une seconde', duree: 1280 },
    { a: 6016, dit: 'Tu peux répéter ?', duree: 1280 },
  ],
  modele: {
    parle: [
      { a: 1000, pourquoi: 'spontaneous', phrases: ['Les pêcheurs rangent les filets sur le quai mouillé.'] },
    ],
    reponses: [
      { si: 'attends', refus: 'Message refusé.', phrases: [] },
      { phrases: ['Je disais que les pêcheurs rentrent.'] },
    ],
  },
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
      id: 'coupee',
      niveau: 'tous',
      mecanisme: 'coupure',
      dit: 'la phrase était pour elle : elle reste coupée',
      evenement: 'coupee',
      ou: { parle: 1 },
    },
    {
      id: 'sans-reponse',
      niveau: 'tous',
      mecanisme: 'serveur',
      dit: 'son fragment refusé, la phrase est sans réponse',
      evenement: 'sans_reponse',
      ou: { parole: 1 },
    },
    {
      id: 'sans-reponse-a-la-fin',
      niveau: 'exact',
      mecanisme: 'serveur',
      dit: 'sans réponse à la fin de la phrase',
      evenement: 'sans_reponse',
      ou: { parole: 1 },
      depuis: { parole: 1, bord: 'debut' },
      // dernière trame 1248 après le début, + 704 (silence), une trame de marge
      entre: [1952, 1984],
    },
    {
      id: 'rien-de-retenu',
      niveau: 'tous',
      mecanisme: 'retenue',
      dit: 'la parole 2 ne retient rien : aucune réponse n’est en route',
      evenement: 'retenue',
      depuis: { parole: 2, bord: 'debut' },
      absent: true,
    },
    {
      id: 'reponse-2',
      niveau: 'tous',
      mecanisme: 'voix',
      dit: 'la parole 2 a sa réponse',
      evenement: 'premier_son',
      ou: { reponse: 2 },
    },
  ],
} satisfies Scenario;
