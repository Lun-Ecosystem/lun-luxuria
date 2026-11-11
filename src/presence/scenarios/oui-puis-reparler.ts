// Moitié serveur, hors de ce niveau : « rien n'est tranché », ce que le serveur fait de la carte quand la réponse au
// « oui » est coupée à mots vides.
//
// Le calcul (trames de 32 ms à partir de 0, DEFAUTS sauf la synthèse, 1000 ms ; pause 160, silence 700, tenue 400) :
// - « oui », parole 1, 320 → 768 : dernière trame 736 ; pause 896 → essai ; transcrite 1046 → envoyée
//   (réponse 1) ; fin 736 + 704 = 1440 → confirmée.
// - réponse 1 : phrase reçue 1046 + 400 = 1446 ; sa synthèse dure jusqu'à 2446.
// - parole 2, 1504 → 3104 (après la fin du « oui », sinon c'est la même phrase) : tenue 1504 + 384 = 1888,
//   pendant la synthèse → retenue de la réponse 1 ; la synthèse finit 558 ms après, la réponse reste muette.
//   Dernière trame 3072 ; pause 3232 → essai, transcrite 3382 → envoyée (réponse 2) ; fin 3072 + 704 = 3776 →
//   confirmée → oubliée la réponse 1, coupure à mots vides.
import type { Scenario } from '../scenario.ts';

export default {
  nom: 'oui-puis-reparler',
  source:
    "dire « oui » sur une carte, puis reparler avant d'entendre « tu as 5 secondes » : rien n'est tranché ;",
  apport: 'une synthèse qui dure pendant la retenue ; les tests la font instantanée',
  mecanismes: ['ecoute', 'essai', 'transcription', 'filtre', 'retenue', 'coupure', 'serveur', 'voix'],
  personne: [
    { a: 320, dit: 'Oui', duree: 448 },
    { a: 1504, dit: 'Attends, en fait je préfère demain', duree: 1600 },
  ],
  modele: {
    reponses: [
      { si: 'demain', phrases: ['Très bien, je garde la carte pour demain.'] },
      { si: 'oui', phrases: ["Tu as 5 secondes pour changer d'avis."] },
    ],
  },
  voix: { syntheseMs: 1000 },
  attendus: [
    {
      id: 'retenue',
      niveau: 'exact',
      mecanisme: 'retenue',
      dit: 'la réponse au « oui » est retenue à la tenue de la parole 2',
      evenement: 'retenue',
      ou: { reponse: 1, valeurs: { par: 2 } },
      depuis: { parole: 2, bord: 'debut' },
      // tenue à 384 ms du début, une trame de marge
      entre: [384, 416],
    },
    {
      id: 'synthese-pendant',
      niveau: 'exact',
      mecanisme: 'voix',
      dit: 'sa synthèse finit pendant la retenue',
      evenement: 'synthese',
      ou: { reponse: 1, valeurs: { etape: 'fin' } },
      depuis: { attendu: 'retenue' },
      // 2446 − 1888 = 558 ; la fenêtre dit seulement : après la retenue, avant la fin de la parole 2 (3104 − 1888)
      entre: [0, 1216],
    },
    {
      id: 'oubliee',
      niveau: 'tous',
      mecanisme: 'retenue',
      dit: 'la réponse au « oui » est oubliée',
      evenement: 'oubliee',
      ou: { reponse: 1 },
    },
    {
      id: 'coupure-vide',
      niveau: 'tous',
      mecanisme: 'coupure',
      dit: 'le serveur reçoit la coupure de la réponse au « oui », sans mot entendu',
      evenement: 'coupure_recue',
      ou: { reponse: 1, valeurs: { entendu: '' } },
    },
    {
      id: 'oui-muet',
      niveau: 'tous',
      mecanisme: 'voix',
      dit: 'rien de la réponse au « oui » ne sonne',
      evenement: 'joue',
      ou: { reponse: 1 },
      absent: true,
    },
  ],
} satisfies Scenario;
