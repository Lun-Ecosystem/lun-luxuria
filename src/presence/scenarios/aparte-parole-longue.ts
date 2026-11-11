// Moitié serveur : aucune. Le point 10 contre le point 9 : CrOliX a choisi la voie 2 le 11/11 (le plan des
// scénarios, « À trancher ») : un aparté pendant qu'elle parle la coupe, il faut redemander. Le scénario attend donc
// ce que fait le code, sans défaut connu, et le point sort de la liste d'écoute.
//
// Le calcul (trames de 32 ms à partir de 0, DEFAUTS sauf 100 ms par caractère ; petit mode : filtre en service,
// fenêtre de 15 s, nom « Agent » absent des phrases) :
// - elle parle seule à 1000 (pourquoi : spontaneous), synthèse → son 1150. Cinq phrases de 53, 52, 51, 57 et
//   56 car. : 5300, 5200, 5100, 5700, 5600 ms, bout à bout (chaque synthèse finit pendant la phrase d'avant) ;
//   la quatrième sonne de 16750 à 22450.
// - l'aparté, parole 1, 21184 → 22784, 20 s après le début de la réponse : tenue 21184 + 384 = 21568 → suspendue,
//   son arrêté, et la fenêtre rafraîchie à 21568. Dernière trame 22752 ; pause 22912 → essai, transcrite 23062 :
//   23062 − 21568 = 1494 ≤ 15000 → pour elle, par la fenêtre ; fin 22752 + 704 = 23456 → confirmée → coupée.
import type { Scenario } from '../scenario.ts';

export default {
  nom: 'aparte-parole-longue',
  source:
    "une phrase dite à quelqu'un d'autre pendant qu'elle parle, au-delà de quinze secondes de réponse : elle reprend ;",
  apport:
    "la fenêtre tenue ouverte phrase après phrase, sur des phrases qui durent : l'aparté est pour elle, et la coupe",
  mecanismes: ['ecoute', 'essai', 'transcription', 'filtre', 'suspension', 'coupure', 'serveur', 'voix'],
  disposition: 'small',
  personne: [{ a: 21184, dit: 'Tu peux fermer la porte en sortant ?', duree: 1600 }],
  modele: {
    parle: [
      {
        a: 1000,
        pourquoi: 'spontaneous',
        phrases: [
          "Le port s'éveille tôt, bien avant que le jour vienne.",
          'Les pêcheurs rangent les filets sur le quai mouillé.',
          'Une cloche sonne au loin, puis les mouettes crient.',
          'Le café du coin ouvre ses volets un peu avant six heures.',
          'Vers sept heures, les premiers bateaux quittent la rade.',
        ],
      },
    ],
    reponses: [{ phrases: ['Je ne peux pas fermer de porte.'] }],
  },
  voix: { msParCaractere: 100 },
  attendus: [
    {
      id: 'suspendue',
      niveau: 'exact',
      mecanisme: 'suspension',
      dit: "l'aparté la suspend à sa tenue",
      evenement: 'suspendue',
      ou: { parle: 1, valeurs: { par: 1 } },
      depuis: { parole: 1, bord: 'debut' },
      // tenue à 384 ms du début, une trame de marge
      entre: [384, 416],
    },
    {
      id: 'verdict-fenetre',
      niveau: 'tous',
      mecanisme: 'filtre',
      dit: "l'aparté, sans son nom, est pour elle par la fenêtre",
      evenement: 'verdict',
      ou: { parole: 1, valeurs: { resultat: 'pour_elle', par: 'fenetre' } },
    },
    {
      id: 'coupee',
      niveau: 'tous',
      mecanisme: 'coupure',
      dit: 'sa parole est coupée',
      evenement: 'coupee',
      ou: { parle: 1 },
    },
    {
      id: 'coupure-recue',
      niveau: 'tous',
      mecanisme: 'coupure',
      dit: 'le serveur reçoit la coupure',
      evenement: 'coupure_recue',
      ou: { parle: 1 },
    },
    {
      id: 'pas-de-reprise',
      niveau: 'tous',
      mecanisme: 'suspension',
      dit: 'elle ne reprend pas (voie 2)',
      evenement: 'reprise_voix',
      ou: { parle: 1 },
      absent: true,
    },
  ],
} satisfies Scenario;
