// Moitié serveur : aucune. Aucun point de la liste d'écoute : ajouté à la relecture du chantier, aucun autre scénario
// ne passant par le refus du filtre (en scène il est coupé ; les apartés des autres tombent dans la fenêtre de 15 s).
//
// Le calcul (trames de 32 ms à partir de 0, DEFAUTS ; petit mode : filtre en service, nom « Agent » par défaut,
// fenêtre de 15 s qu'elle n'a pas ouverte, elle n'a pas encore parlé ; pause 160, silence 700) :
// - parole 1, 320 → 1600, sans son nom : dernière trame 1568 ; pause 1728 → essai, transcrite 1878 → écartée, rien
//   ne part ; fin 2272 → sans réponse.
// - parole 2, 4000 → 5600, avec son nom : dernière trame 5568 ; pause 5728 → essai, transcrite 5878 → pour elle par
//   le nom, envoyée (1878 ms après le début de la parole) ; fin 6272 → confirmée ; phrase reçue 5878 + 400 = 6278,
//   synthèse → premier son 6428. C'est le premier texte que le serveur reçoit : la réponse 1.
import type { Scenario } from '../scenario.ts';

export default {
  nom: 'phrase-ecartee',
  source:
    "aucun point de la liste : le refus du filtre, qu'aucun autre scénario ne joue (une phrase sans son nom, en petit mode, quand elle n'a pas parlé)",
  apport:
    'le refus du filtre par la vraie écoute et la vraie transcription : la phrase écartée ne part pas, celle qui la nomme part',
  mecanismes: ['ecoute', 'essai', 'transcription', 'filtre', 'serveur', 'voix'],
  disposition: 'small',
  personne: [
    { a: 320, dit: 'Tu as vu mes clés quelque part ?', duree: 1280 },
    { a: 4000, dit: 'Agent, quelle heure est-il ?', duree: 1600 },
  ],
  modele: { reponses: [{ si: 'heure', phrases: ['Il est dix heures.'] }] },
  attendus: [
    {
      id: 'ecartee',
      niveau: 'tous',
      mecanisme: 'filtre',
      dit: 'la phrase sans son nom est écartée',
      evenement: 'verdict',
      ou: { parole: 1, valeurs: { resultat: 'ecartee' } },
    },
    {
      id: 'rien-ne-part',
      niveau: 'tous',
      mecanisme: 'serveur',
      dit: "rien ne part au serveur avant qu'il la nomme",
      evenement: 'envoi_recu',
      depuis: { parole: 1, bord: 'debut' },
      // jusqu'au début de la parole 2 : 4000 − 320
      entre: [0, 3680],
      absent: true,
    },
    {
      id: 'nommee',
      niveau: 'tous',
      mecanisme: 'filtre',
      dit: 'la phrase qui la nomme est pour elle, par le nom',
      evenement: 'verdict',
      ou: { parole: 2, valeurs: { resultat: 'pour_elle', par: 'nom' } },
    },
    {
      id: 'envoyee',
      niveau: 'exact',
      mecanisme: 'serveur',
      dit: 'elle part à sa transcription',
      evenement: 'envoi_recu',
      ou: { valeurs: { texte: 'Agent, quelle heure est-il ?' } },
      depuis: { parole: 2, bord: 'debut' },
      // dernière trame 1568 après le début, + 160 (pause) + 150 (transcription) = 1878, une trame de marge
      entre: [1878, 1910],
    },
    {
      id: 'elle-repond',
      niveau: 'tous',
      mecanisme: 'voix',
      dit: 'la réponse au premier texte reçu sonne',
      evenement: 'premier_son',
      ou: { reponse: 1 },
    },
  ],
} satisfies Scenario;
