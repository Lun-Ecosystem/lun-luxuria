// Moitié serveur : ce que le serveur fait de la coupure, au-delà de la recevoir. Hors de ce niveau : le temps gagné
// avec la vraie synthèse, au desktop ; le service finit sous son verrou la synthèse qu'il a commencée.
//
// Le calcul (trames de 32 ms à partir de 0, DEFAUTS sauf la synthèse à 2000 ms ; pause 160, silence 700) :
// - parole 1, 320 → 1600 : dernière trame 1568 ; pause 1728 → essai, transcrite 1878 → envoyée (réponse 1) ;
//   fin 2272 → confirmée. Ses quatre phrases reçues à 2278, 2578, 2878, 3178.
// - une synthèse à la fois : la phrase 1 de 2278 à 4278, premier son 4278 ; la phrase 2 commence à ce même instant.
// - le geste, 200 ms après ce premier son : 4478. `stop()` : `arretee`, 200 / 2820 → aucun mot entendu sur dix ; la
//   coupure part. La synthèse de la phrase 2, commencée, finit à 6278 ; les phrases 3 et 4, en file derrière elle,
//   ne commencent jamais.
// - parole 2, 400 ms après le premier son : 4678 → 5318, première trame de voix 4704, dernière 5312 ; pause 5472 →
//   essai, transcrite 5622 → envoyée (réponse 2) ; fin 6016 → confirmée ; sa phrase reçue 6022, pendant la synthèse
//   commencée : la sienne de 6278 à 8278, premier son 8278, 2000 ms après la fin de l'autre.
// - 2000 ms et non 1000 : à 1000, la synthèse commencée finirait à 5278, avant que toute seconde demande ait sa
//   phrase ; elle ne compterait plus dans ce premier son.
// - jusqu'à 14000 : si les phrases 3 et 4 étaient synthétisées (6278 → 10278), la réponse 2 sonnerait à 12278 ; la
//   partie le voit encore.
import type { Scenario } from '../scenario.ts';

export default {
  nom: 'arrete-puis-question',
  source:
    'aucun point de la liste : sa voix synthétise encore les phrases d’un tour jeté, et la réponse suivante les attend (audit du 12/11, I11)',
  apport:
    'le bouton au premier son de quatre phrases lentes à faire : rien de la réponse arrêtée ne se fait plus, la question suivante n’attend que la synthèse commencée',
  mecanismes: ['ecoute', 'essai', 'transcription', 'filtre', 'coupure', 'serveur', 'voix'],
  personne: [
    { a: 320, dit: 'Raconte-moi la journée de demain', duree: 1280 },
    { apres: { joue: 1, phrase: 1, ms: 400 }, dit: 'Et samedi ?', duree: 640 },
  ],
  modele: {
    reponses: [
      {
        si: 'demain',
        phrases: [
          'Demain matin il fera frais avec un peu de vent.',
          "L'après-midi restera doux.",
          "Le soir la pluie arrivera par l'ouest.",
          'La nuit sera calme.',
        ],
      },
      { si: 'samedi', phrases: ['Samedi sera ensoleillé.'] },
    ],
  },
  voix: { syntheseMs: 2000 },
  gestes: [{ geste: 'silence', apres: { joue: 1, phrase: 1, ms: 200 } }],
  jusqua: 14000,
  attendus: [
    {
      id: 'geste',
      niveau: 'tous',
      mecanisme: 'coupure',
      dit: 'le bouton est pressé pendant la phrase 1',
      evenement: 'geste',
      ou: { valeurs: { geste: 'silence', etape: 'fait' } },
    },
    {
      id: 'arretee',
      niveau: 'tous',
      mecanisme: 'coupure',
      dit: 'la page écrit la coupure de la réponse 1',
      evenement: 'arretee',
      ou: { reponse: 1 },
      depuis: { attendu: 'geste' },
    },
    {
      id: 'aucune-synthese',
      niveau: 'tous',
      mecanisme: 'voix',
      dit: 'aucune synthèse ne commence pour la réponse 1 après son arrêt',
      evenement: 'synthese',
      ou: { reponse: 1, valeurs: { etape: 'debut' } },
      depuis: { attendu: 'arretee' },
      absent: true,
    },
    {
      id: 'commencee-finit',
      niveau: 'exact',
      mecanisme: 'voix',
      dit: 'la synthèse de la phrase 2, commencée avant l’arrêt, finit',
      evenement: 'synthese',
      ou: { reponse: 1, valeurs: { etape: 'fin', rang: 2 } },
      depuis: { attendu: 'arretee' },
      // 6278 − 4478, une trame de marge
      entre: [1800, 1832],
    },
    {
      id: 'reponse-2',
      niveau: 'tous',
      mecanisme: 'voix',
      dit: 'la réponse à la seconde demande sonne',
      evenement: 'premier_son',
      ou: { reponse: 2 },
    },
    {
      id: 'reponse-2-a-temps',
      niveau: 'exact',
      mecanisme: 'voix',
      dit: 'elle n’attend que la synthèse commencée, puis la sienne',
      evenement: 'premier_son',
      ou: { reponse: 2 },
      depuis: { attendu: 'commencee-finit' },
      // sa synthèse, 2000 ms, une trame de marge
      entre: [2000, 2032],
    },
  ],
} satisfies Scenario;
