// Moitié serveur : ce que le serveur fait de la coupure, au-delà de la recevoir. Hors de ce niveau : « réfléchit »,
// que le joueur ne voit pas (le test de `conversation.test.ts` le tient) ; un vrai serveur figé, à la main.
//
// Le calcul (trames de 32 ms à partir de 0, DEFAUTS ; pause 160, silence 700) :
// - parole 1, 320 → 1600 : dernière trame 1568 ; pause 1728 → essai, transcrite 1878 → envoyée (réponse 1), son
//   numéro à 1898 ; fin 2272 → confirmée. Sa première phrase ne vient pas.
// - la garde du serveur, 60 s après l'envoi : 61878 → la réponse 1 oubliée et coupée, sans mot entendu ; la phrase
//   est sans réponse.
import type { Scenario } from '../scenario.ts';

export default {
  nom: 'reponse-figee',
  source:
    'aucun point de la liste : une réponse qui ne vient pas laisse la page attendre sans fin, « réfléchit » allumé (audit du 12/11, I6)',
  apport:
    'une réponse dont la première phrase ne vient pas finit à sa garde : coupée au serveur, et la phrase est sans réponse',
  mecanismes: ['ecoute', 'essai', 'transcription', 'filtre', 'retenue', 'coupure', 'serveur'],
  personne: [{ a: 320, dit: 'Raconte-moi la journée de demain', duree: 1280 }],
  modele: { reponses: [{ premierMotMs: 600_000, phrases: ['Demain il fera beau.'] }] },
  jusqua: 65_000,
  attendus: [
    {
      id: 'envoyee',
      niveau: 'tous',
      mecanisme: 'serveur',
      dit: 'la parole 1 part au serveur',
      evenement: 'envoyee',
      ou: { parole: 1 },
    },
    {
      id: 'oubliee',
      niveau: 'tous',
      mecanisme: 'retenue',
      dit: 'la réponse 1 est oubliée',
      evenement: 'oubliee',
      ou: { reponse: 1 },
    },
    {
      id: 'coupure-vide',
      niveau: 'tous',
      mecanisme: 'coupure',
      dit: 'le serveur reçoit la coupure de la réponse 1, sans mot entendu',
      evenement: 'coupure_recue',
      ou: { reponse: 1, valeurs: { entendu: '' } },
    },
    {
      id: 'sans-reponse',
      niveau: 'tous',
      mecanisme: 'serveur',
      dit: 'la phrase est sans réponse',
      evenement: 'sans_reponse',
      ou: { parole: 1 },
    },
    {
      id: 'sans-reponse-a-la-garde',
      niveau: 'exact',
      mecanisme: 'serveur',
      dit: 'sans réponse à la garde du serveur',
      evenement: 'sans_reponse',
      ou: { parole: 1 },
      depuis: { attendu: 'envoyee' },
      // la garde, 60 s après l'envoi
      entre: [60_000, 60_000],
    },
  ],
} satisfies Scenario;
