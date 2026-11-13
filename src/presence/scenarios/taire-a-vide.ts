// Moitié serveur : aucune. Hors de ce niveau : le vrai chemin, le lien perdu, que `live` redit toutes les 3 s tant
// que le serveur ne répond pas ; la page appelle alors `speaker.stop()` (`session.svelte.ts`, `link(false)`), le même
// `stop()` que le bouton « Faire taire » joué ici.
//
// Le calcul (trames de 32 ms à partir de 0, DEFAUTS ; petit mode : filtre en service, nom « Agent » absent de la
// phrase, fenêtre de 15 s bornes comprises ; pause 160, silence 700) :
// - elle parle seule à 1000 (pourquoi : spontaneous), synthèse → son 1150 ; 30 car. × 60 = 1800 ms, fin 2950 :
//   `silence`, et la fenêtre court depuis 2950.
// - le geste 16 s après : 18950, la fenêtre fermée depuis 17950. Rien ne sonne ni n'attend : `stop()` ne dit rien.
// - parole 1, 2 s après, à la trame : 20960 → 22240, sans son nom ; dernière trame 22208 ; pause 22368 → essai,
//   transcrite 22518 : 22518 − 2950 = 19568 > 15000 → écartée, rien ne part ; fin 22912 → sans réponse.
import type { Scenario } from '../scenario.ts';

export default {
  nom: 'taire-a-vide',
  source:
    'aucun point de la liste : un serveur injoignable garde la pièce « adressée » (audit du 12/11, I7), par un arrêt de sa voix quand rien ne sonne',
  apport:
    'un arrêt quand rien ne sonne ne rouvre pas la fenêtre de 15 s : la phrase sans son nom qui suit reste écartée',
  mecanismes: ['ecoute', 'essai', 'transcription', 'filtre', 'serveur', 'voix'],
  disposition: 'small',
  personne: [{ a: 20960, dit: 'Tu as vu mes clés quelque part ?', duree: 1280 }],
  modele: { parle: [{ a: 1000, pourquoi: 'spontaneous', phrases: ['Il commence à pleuvoir dehors.'] }] },
  gestes: [{ geste: 'silence', a: 18950 }],
  attendus: [
    {
      id: 'tue',
      niveau: 'exact',
      mecanisme: 'voix',
      dit: 'elle se tait à la fin de sa phrase, et la fenêtre court de là',
      evenement: 'silence',
      // 1150 + 1800, une trame de marge
      entre: [2950, 2982],
    },
    {
      id: 'geste',
      niveau: 'tous',
      mecanisme: 'voix',
      dit: 'le bouton est pressé, la fenêtre fermée',
      evenement: 'geste',
      ou: { valeurs: { geste: 'silence', etape: 'fait' } },
    },
    {
      id: 'rien-au-geste',
      niveau: 'tous',
      mecanisme: 'voix',
      dit: 'rien ne sonne : le bouton n’écrit aucun silence',
      evenement: 'silence',
      depuis: { attendu: 'geste' },
      absent: true,
    },
    {
      id: 'ecartee',
      niveau: 'tous',
      mecanisme: 'filtre',
      dit: 'la phrase sans son nom est écartée, la fenêtre restée fermée',
      evenement: 'verdict',
      ou: { parole: 1, valeurs: { resultat: 'ecartee' } },
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
