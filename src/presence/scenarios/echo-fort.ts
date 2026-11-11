// Moitié serveur : aucune. Hors de ce niveau : l'annulation d'écho du navigateur, qui seule décide si l'écho passe
// (étapes 3 à 5) ; ici l'écho n'est pas annulé, et le scénario mesure ce que la page fait s'il passe. Chaque attente
// est donc `exact` : à la chaîne, un écho annulé les ferait toutes manquer, et ce serait le bon résultat.
// L'écho sous le seuil est sorti : il ne prouve que le seuil de l'écoute.
// La boucle n'est pas jouée : sa réponse à ses propres mots (« Hm. », 180 ms) est trop courte pour une tenue, son
// écho finit en bruit. Se suspendre en boucle se mesurera à la chaîne, avec l'annulation d'écho.
//
// Le calcul (trames de 32 ms à partir de 0, DEFAUTS ; petit mode : filtre en service, fenêtre de 15 s) :
// - elle parle seule à 1000 (pourquoi : spontaneous), synthèse → son 1150, 66 car. × 60 = 3960 ms ; son écho à 0,7
//   (≥ 0,6) dès la trame 1152.
// - tenue 1152 + 384 = 1536 (386 ms après le début du son) → suspendue, son arrêté, l'écho cesse avec lui.
//   Dernière trame 1536 ; pause 1696 → essai, transcrite 1846 : ses propres mots, pour elle par la fenêtre
//   (rafraîchie à la tenue), envoyée ; fin 1536 + 704 = 2240 → confirmée → coupée, coupure au serveur.
import type { Scenario } from '../scenario.ts';

export default {
  nom: 'echo-fort',
  source: 'son propre son repris par le micro : elle ne doit pas se suspendre en boucle ;',
  apport: 'aucun test ne fait entrer sa voix dans le micro : la chaîne entière sur son propre écho',
  mecanismes: ['ecoute', 'essai', 'transcription', 'filtre', 'suspension', 'coupure', 'serveur', 'voix'],
  disposition: 'small',
  personne: [],
  echo: { voix: 0.7 },
  modele: {
    parle: [
      {
        a: 1000,
        pourquoi: 'spontaneous',
        phrases: ['Il commence à pleuvoir, pense à rentrer le linge qui sèche dehors.'],
      },
    ],
    // A `si`: without it the false server would answer each of its own echoes, for ever.
    reponses: [{ si: 'pleuvoir', phrases: ['Hm.'] }],
  },
  attendus: [
    {
      id: 'son-debut',
      niveau: 'exact',
      mecanisme: 'voix',
      dit: 'elle parle',
      evenement: 'son',
      ou: { parle: 1, valeurs: { etape: 'debut' } },
    },
    {
      id: 'tenue',
      niveau: 'exact',
      mecanisme: 'ecoute',
      dit: 'son écho fait une tenue',
      evenement: 'tenue',
      depuis: { attendu: 'son-debut' },
      // première trame d'écho dans les 32 ms qui suivent le son, puis 384 : [384, 416]
      entre: [384, 416],
    },
    {
      id: 'suspendue',
      niveau: 'exact',
      mecanisme: 'suspension',
      dit: 'son écho la suspend',
      evenement: 'suspendue',
      ou: { parle: 1 },
    },
    {
      id: 'transcrite',
      niveau: 'exact',
      mecanisme: 'transcription',
      dit: 'la transcription rend ses propres mots',
      evenement: 'transcrite',
      ou: { valeurs: { texte: 'Il commence à pleuvoir, pense à rentrer le linge qui sèche dehors.' } },
    },
    {
      id: 'verdict-fenetre',
      niveau: 'exact',
      mecanisme: 'filtre',
      dit: 'ses propres mots sont pour elle, par la fenêtre',
      evenement: 'verdict',
      ou: { valeurs: { resultat: 'pour_elle', par: 'fenetre' } },
    },
    {
      id: 'coupure-recue',
      niveau: 'exact',
      mecanisme: 'coupure',
      dit: 'sa parole est coupée par son écho',
      evenement: 'coupure_recue',
      ou: { parle: 1 },
    },
    {
      id: 'envoi-recu',
      niveau: 'exact',
      mecanisme: 'serveur',
      dit: 'le serveur reçoit ses propres mots',
      evenement: 'envoi_recu',
      ou: { valeurs: { texte: 'Il commence à pleuvoir, pense à rentrer le linge qui sèche dehors.' } },
    },
  ],
} satisfies Scenario;
