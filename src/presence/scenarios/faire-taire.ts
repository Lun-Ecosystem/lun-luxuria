// Moitié serveur, hors de ce niveau : ce que le serveur fait de la coupure, au-delà de la recevoir.
//
// Le bouton « Faire taire » appelle `silence()` (`conversation.ts`), qui appelle `speaker.stop()` (`speaker.ts`) :
// le son s'arrête sur-le-champ, la suite est jetée, et ce qui a été entendu part au serveur comme coupure.
//
// Le calcul (trames de 32 ms à partir de 0, DEFAUTS, réglages par défaut : pause 160, silence 700) :
// - parole 1, 320 → 1600 : envoyée à 1878 (réponse 1), confirmée à 2272 ; phrase 1 coupée à sa virgule comme le
//   fait le serveur, « Demain matin il fera frais, » reçue 2278, son 2428, 27 car. × 60 = 1620 ms, 5 mots.
// - le geste, 1 s après ce premier son : 3428. `stop()` : `silence` coupée, `son` arrêté, la sortie se tait,
//   `arretee` avec 1000 / 1620 = 0,617 → 3 mots sur 5 ; la coupure part au serveur. Les phrases 2 et 3, déjà
//   synthétisées ou en cours, ne sonnent jamais.
import type { Scenario } from '../scenario.ts';

export default {
  nom: 'faire-taire',
  // Aucun point de la liste d'écoute : la phrase du plan de la chaîne (lun-docs, 2026-11-11-chaine-laptop.md).
  source: 'Le bouton « Faire taire » a son scénario.',
  apport: 'le bouton joué au milieu d’une réponse de trois phrases, à un instant ancré sur ce qui sonne',
  mecanismes: ['ecoute', 'essai', 'transcription', 'filtre', 'coupure', 'serveur', 'voix'],
  personne: [{ a: 320, dit: 'Raconte-moi la journée de demain', duree: 1280 }],
  modele: {
    reponses: [
      {
        phrases: [
          'Demain matin il fera frais, puis le soleil reviendra vers midi avec un peu de vent.',
          "L'après-midi restera doux.",
          "Le soir, la pluie arrivera par l'ouest.",
        ],
      },
    ],
  },
  gestes: [{ geste: 'silence', apres: { joue: 1, phrase: 1, ms: 1000 } }],
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
      id: 'sortie-arretee',
      niveau: 'exact',
      mecanisme: 'voix',
      dit: 'la sortie se tait dans la trame qui suit le geste',
      evenement: 'arrete',
      ou: { reponse: 1 },
      depuis: { attendu: 'geste' },
      // `stop()` arrête le son au même instant ; une trame de marge
      entre: [0, 32],
    },
    {
      id: 'son-arrete',
      niveau: 'exact',
      mecanisme: 'voix',
      dit: 'la page écrit le son arrêté dans la trame qui suit le geste',
      evenement: 'son',
      ou: { reponse: 1, valeurs: { etape: 'fin', arrete: true } },
      depuis: { attendu: 'geste' },
      entre: [0, 32],
    },
    {
      id: 'silence-coupe',
      niveau: 'tous',
      mecanisme: 'voix',
      dit: 'elle se tait, coupée',
      evenement: 'silence',
      ou: { valeurs: { coupee: true } },
      depuis: { attendu: 'geste' },
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
      id: 'arretee-entendu',
      niveau: 'exact',
      mecanisme: 'coupure',
      dit: 'coupée, trois mots entendus sur cinq',
      evenement: 'arretee',
      ou: { reponse: 1, valeurs: { entendu: 'Demain matin il' } },
      depuis: { attendu: 'geste' },
      entre: [0, 32],
    },
    {
      id: 'coupure-recue',
      niveau: 'tous',
      mecanisme: 'coupure',
      dit: 'le serveur reçoit la coupure de la réponse 1',
      evenement: 'coupure_recue',
      ou: { reponse: 1 },
    },
    {
      id: 'coupure-recue-entendu',
      niveau: 'exact',
      mecanisme: 'coupure',
      dit: 'le serveur reçoit les mots entendus',
      evenement: 'coupure_recue',
      ou: { reponse: 1, valeurs: { entendu: 'Demain matin il' } },
    },
    {
      id: 'pour-de-bon',
      niveau: 'tous',
      mecanisme: 'voix',
      dit: 'plus rien de la réponse 1 ne sonne',
      evenement: 'joue',
      ou: { reponse: 1 },
      depuis: { attendu: 'geste' },
      absent: true,
    },
  ],
} satisfies Scenario;
