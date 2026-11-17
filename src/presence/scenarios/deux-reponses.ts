// Moitié serveur, hors de ce niveau : la file d'une page seulement. Ce que CrOliX a entendu le 10/11 (deux réponses
// qui sonnent ensemble) n'est pas prouvé par ce scénario : sa cause reste inconnue.
//
// La coupure est coupée (`bargeIn.on` à faux) : la parole 2 ne suspend pas la réponse 1, qui sonne jusqu'au bout.
// Ce qui est éprouvé : la réponse 1 est finie (sa dernière phrase reçue) et cette phrase sonne encore quand la
// réponse 2 arrive. La file n'a alors qu'une garde, `#playing` : sans elle, la réponse 2 sonnerait par-dessus.
import type { Scenario } from '../scenario.ts';

export default {
  nom: 'deux-reponses',
  source: "deux phrases à trois secondes d'écart, la coupure coupée : jamais deux réponses ensemble ;",
  apport: 'la file ne joue pas la réponse 2 tant que la dernière phrase de la réponse 1 sonne',
  mecanismes: ['ecoute', 'essai', 'transcription', 'filtre', 'serveur', 'voix'],
  reglages: { bargeIn: { on: false } },
  personne: [
    { a: 320, dit: 'Tu peux me rappeler le film de ce soir', duree: 1280 },
    { apres: { envoi: 1, ms: 2730 }, dit: 'Et aussi la météo de demain', duree: 1280 },
  ],
  modele: {
    reponses: [
      {
        si: 'film',
        phrases: [
          'Ce soir, il y a un vieux western à vingt et une heures, sur la deuxième chaîne, avec un grand héros.',
        ],
      },
      { si: 'meteo', phrases: ['Demain, il fera beau.'] },
    ],
  },
  attendus: [
    {
      id: 'phrase-1-recue',
      niveau: 'tous',
      mecanisme: 'serveur',
      dit: 'la réponse 1 est finie : sa phrase est reçue',
      evenement: 'phrase_recue',
      ou: { reponse: 1 },
    },
    {
      id: 'phrase-2-recue',
      niveau: 'tous',
      mecanisme: 'serveur',
      dit: 'la réponse 2 arrive bien après la réponse 1, et avant la fin de son son',
      evenement: 'phrase_recue',
      ou: { reponse: 2 },
      depuis: { attendu: 'phrase-1-recue' },
      entre: [3000, 5500],
    },
    {
      id: 'son-1-encore',
      niveau: 'tous',
      mecanisme: 'voix',
      dit: 'la dernière phrase de la réponse 1 sonne encore quand la réponse 2 arrive',
      evenement: 'arrete',
      ou: { reponse: 1 },
      depuis: { attendu: 'phrase-2-recue' },
      entre: [1, 3000],
    },
    {
      id: 'joue-1',
      niveau: 'tous',
      mecanisme: 'voix',
      dit: 'la réponse 1 sonne',
      evenement: 'joue',
      ou: { reponse: 1 },
    },
    {
      id: 'joue-2',
      niveau: 'tous',
      mecanisme: 'voix',
      dit: 'la réponse 2 sonne',
      evenement: 'joue',
      ou: { reponse: 2 },
    },
    {
      id: 'reponses-ensemble',
      niveau: 'tous',
      mecanisme: 'voix',
      dit: 'jamais deux réponses ensemble',
      mesure: 'reponses_ensemble',
      entre: [0, 0],
    },
  ],
} satisfies Scenario;
