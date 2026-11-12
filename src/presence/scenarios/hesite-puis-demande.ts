// Moitié serveur : aucune. Hors de ce niveau : ce que la voix fait de « euh » (mot, bruit ou rien selon la voix),
// et le nombre de pauses que Silero voit : les attentes `tous` n'en dépendent pas.
//
// « euh » n'est pas un son à part : c'est de la voix entre deux silences, que `dit` porte comme un mot et `trous`
// comme deux silences. L'attente porte sur le mécanisme (une seule demande, l'essai de la première pause retiré),
// jamais sur le mot ni sur le numéro de l'essai confirmé.
//
// Le calcul (trames de 32 ms à partir de 0, DEFAUTS, l'essai en service ; pause 160, silence 700 ; parole 320 →
// 3200, trous à 896 (160 ms) et 1280 (400 ms), donc voix 320 → 1216, « euh » 1376 → 1600, voix 2000 → 3200) :
// - « Tu peux me lire, » : dernière trame de voix 1184 ; 5 trames de silence (1216 → 1344) = 160 ms, pause 1184 + 160
//   = 1344 → essai 1 ; la voix revient à 1376 (« euh ») → reprise → essai 1 retiré, avant sa transcription (1494) :
//   il n'est jamais envoyé.
// - « euh » : dernière trame 1568 ; pause 1728 → essai 2 ; transcrite 1878 → envoyé (message 1) ; la voix revient à
//   2000, première trame de voix 2016 (2000 n'est pas un multiple de 32) → reprise → essai 2 retiré, son retrait
//   reçu à 2016. Le silence a duré 2016 − 1568 = 448 ms < 704 : pas de fin.
// - « la liste des courses » : dernière trame 3168 ; pause 3328 → essai 3 ; transcrite 3478 → envoyé, tenu ; fin
//   3168 + 704 = 3872 → confirmée ; phrase reçue 3478 + 400 = 3878 ; synthèse → premier son 4028.
//   attente_fin = 704 ; blanc_de_tour = 4028 − 3168 = 860 = 160 + 150 + 400 + 150, comme sans « euh »
//   (delai-a-l-essai).
// - l'essai 1 retiré à 1376, soit 1056 ms après le début de la parole (1376 − 320).
import type { Scenario } from '../scenario.ts';

export default {
  nom: 'hesite-puis-demande',
  source: "une hésitation au milieu d'une demande : la phrase tient, une seule demande part ;",
  apport:
    "un « euh » entre deux silences plus courts que la fin : l'essai de la première pause est retiré, une seule demande reste",
  mecanismes: ['ecoute', 'essai', 'filtre', 'serveur', 'voix'],
  personne: [
    {
      a: 320,
      dit: 'Tu peux me lire, euh, la liste des courses',
      duree: 2880,
      trous: [
        { a: 896, duree: 160 },
        { a: 1280, duree: 400 },
      ],
    },
  ],
  modele: { reponses: [{ phrases: ['Il reste du pain, des pommes et du lait.'] }] },
  attendus: [
    {
      id: 'une-seule-phrase',
      niveau: 'tous',
      mecanisme: 'ecoute',
      dit: "la parole entière est une seule phrase de la page : « euh » n'en ouvre pas une autre",
      evenement: 'voix',
      ou: { valeurs: { phrase: 2 } },
      absent: true,
    },
    {
      id: 'pas-un-bruit',
      niveau: 'tous',
      mecanisme: 'filtre',
      dit: "aucune phrase n'est jugée bruit",
      evenement: 'bruit',
      absent: true,
    },
    {
      id: 'essai-retire',
      niveau: 'tous',
      mecanisme: 'essai',
      dit: "l'essai de la première pause est retiré quand la voix revient",
      evenement: 'retiree',
      ou: { parole: 1, essai: 1 },
    },
    {
      id: 'retrait-recu',
      niveau: 'tous',
      mecanisme: 'serveur',
      dit: "l'essai envoyé puis retiré a son retrait au serveur",
      evenement: 'retrait_recu',
      ou: { valeurs: { message: 1 } },
    },
    {
      id: 'fin-confirmee',
      niveau: 'tous',
      mecanisme: 'essai',
      dit: 'la fin de la phrase en confirme un, le dernier',
      evenement: 'confirmee',
      ou: { parole: 1 },
    },
    {
      id: 'elle-repond',
      niveau: 'tous',
      mecanisme: 'voix',
      dit: 'une réponse sonne',
      evenement: 'premier_son',
      ou: { parole: 1 },
    },
    {
      id: 'rien-de-l-essai-retire',
      niveau: 'tous',
      mecanisme: 'voix',
      dit: "rien de la réponse à l'essai retiré ne sonne",
      evenement: 'joue',
      ou: { reponse: 1 },
      absent: true,
    },
    {
      id: 'essai-retire-a-la-voix',
      niveau: 'exact',
      mecanisme: 'essai',
      dit: 'la voix revient sur « euh », 1056 ms après le début, à une trame près',
      evenement: 'retiree',
      ou: { parole: 1, essai: 1 },
      depuis: { parole: 1, bord: 'debut' },
      // 1376 − 320 = 1056
      entre: [1056, 1088],
    },
    {
      id: 'attente-fin',
      niveau: 'exact',
      mecanisme: 'ecoute',
      dit: "la fin tombe 0,7 s après la dernière voix, à une trame près, les essais n'y changent rien",
      delai: 'attente_fin',
      tour: { parole: 1 },
      // 22 trames × 32 = 704
      entre: [700, 736],
    },
    {
      id: 'blanc-de-tour',
      niveau: 'exact',
      mecanisme: 'voix',
      dit: 'le blanc après « courses » : une pause, la transcription, le premier mot, la synthèse',
      delai: 'blanc_de_tour',
      tour: { parole: 1 },
      // 160 + 150 + 400 + 150 = 860, une trame de marge
      entre: [860, 892],
    },
  ],
} satisfies Scenario;
