# Lun'Luxuria

## Lancer

1. La voix : `uv run voix/service.py --stt faster:small --tts piper:<voix.onnx> [--rvc <url>]`. Autres briques :
   `--stt whisper-server:<url>` (whisper.cpp par Vulkan), `--tts kokoro:<modèle.onnx>:<voix.bin>`. `--lang` règle la
   langue transcrite (`fr` par défaut). Dans un onglet, c'est la seule façon de le lancer : l'écran renvoie ici.
   - **Sans synthèse** : `--tts aucun`, ou sans `--tts`. `/tts` répond 503 et `/ping` dit `"tts": "aucun"` ; la
     chaîne du banc s'en sert quand sa voix est servie par le joueur.
   - **Confiance** : avec faster-whisper, l'exponentielle de la moyenne d'`avg_logprob`, qui compte aussi horodatages
     et fin de texte. Avec whisper-server, la moyenne géométrique des probabilités des seuls jetons de texte
     (`verbose_json`), car son `avg_logprob` divise par un compte qui inclut les jetons spéciaux. Les deux ne se
     comparent pas : la barre de geste se juge sur la brique en service. Sans aucun mot, la confiance vaut 0.
   - **RVC** : 50 ms de silence devant, puis des blocs de 0,5 s à 48 kHz, un appel à la fois. Le service rend la phrase
     entière, à sa longueur utile. `--rvc-gain` règle le gain de sortie (2,0 par défaut), borné à [-1, 1].
2. L'app : `npm run dev`, puis http://127.0.0.1:5180. L'arrivée dit ce que demande chaque fonctionnement, puis
   « Entrer » : un onglet ne joue aucun son sans un clic. La fenêtre, elle, entre seule (plus bas).
3. Son cerveau, au choix :
   - **Seul** : à l'arrivée ou dans les Réglages, l'adresse d'un service compatible OpenAI et le nom du modèle. Le
     service doit accepter les appels du navigateur : Ollama accepte 127.0.0.1, un autre peut demander de régler ses
     origines (CORS).
   - **Relié** : un serveur joignable par `CORE_URL` (8788 par défaut) et son code d'appairage. Dans l'écosystème Lun',
     c'est le core : `npm run pair-code` dans lun-anima, et pour un essai un core jetable avec son propre `DB_PATH`.

Le micro reste coupé tant que le bouton ne l'a pas ouvert. Coupé, aucune capture ne tourne, et il ne se rallume jamais seul.

## La fenêtre (Windows)

Prérequis en plus : Rust stable (cible MSVC) et les Build Tools de Visual Studio (C++). WebView2 est déjà sur Windows 11.

- **Essai** : `npm run tauri dev` ouvre la fenêtre sur la page de `npm run dev`, rechargée à chaque modification.
- **Exe** : `npm run tauri build -- --no-bundle` donne `src-tauri/target/release/lun-luxuria.exe`, sans console et en
  un seul exemplaire : un second lancement ramène la fenêtre ouverte. Aucun installateur pour l'instant.

Une seule fenêtre, deux formes : la **scène** prend tout l'écran choisi, le **petit mode** est une vignette sans bord,
toujours au premier plan, que l'on déplace en la tirant et qui revient là où on l'a laissée. Le raccourci global
(`Control+Shift+L` par défaut) passe de l'une à l'autre depuis n'importe quelle appli, et la touche tenue marche aussi
fenêtre inactive. Une touche qui écrit (lettre, chiffre, espace, entrée) est refusée en global.

**Entrer seule.** Quand rien ne manque (relié : un jeton ; seul : l'adresse et le nom du modèle), la fenêtre entre
sans clic, une seule fois, après le premier verdict du service voix : en attendant, « Sa voix se prépare… » et
« Entrer sans attendre ». Le son part sans clic : wry passe `--autoplay-policy=no-user-gesture-required` à WebView2,
vu sur la ligne de commande de l'exe. S'il manque quelque chose, l'arrivée le demande. Un jeton que le serveur refuse
(401) est oublié, et l'arrivée revient avec le code et le dit.

**Le micro.** WebView2 demande l'accès une fois, au premier « Ouvrir le micro », et garde la réponse pour l'origine de
l'app dans son profil : relancée, la fenêtre ne redemande rien (vu dans l'exe : « Autoriser », relance, accès accordé sans
boîte). Un « Bloquer » se garde de la même façon. Pour qu'elle redemande, fermer l'appli et supprimer
`EBWebView\Default\Preferences` dans son dossier de données (`%LOCALAPPDATA%\io.github.lun-ecosystem.luxuria`) : les
réglages et le fil restent, ils vivent ailleurs dans ce profil.

**L'absence**, relié seulement. Sans saisie au clavier ni à la souris dans toute la session, ni phrase qui passe le
filtre, depuis le délai réglé (15 minutes par défaut, de 1 à 240, carte « La fenêtre »), la présence s'arrête au
serveur. Une session verrouillée ne reçoit aucune saisie : elle compte aussi. La première saisie, ou la première
phrase qui passe le filtre, la reprend, avec l'accueil s'il est actif ; un bruit ou une phrase filtrée ne comptent
pas. Le temps sans saisie se lit toutes les 30 s, toutes les 3 s pendant l'absence. L'absence ne change que ce qui est
annoncé : l'écoute et la sourdine restent ce qu'elles sont.

Ce qui change dans la fenêtre, et seulement là (carte « La fenêtre » des Réglages) :

- **Le réseau** : le serveur et le modèle sont joints par le côté Rust, sans CORS. L'adresse du serveur se règle à
  l'écran ; la changer oublie le jeton, il faut appairer de nouveau. Le service voix reste joint par la page : ses
  origines comptent `http://tauri.localhost`.
- **Le corps** : un dossier avec `corps.json` (`{"niveau":"images","repos":"repos.png","parole":"parole.png",
  "vignette":{"zoom":2,"x":50,"y":30}}`). Seuls ses fichiers images directs sont lus (png, jpg, webp, gif, 10 Mo au plus).
  Une image manquante rend le souffle, et l'écran dit pourquoi ; « Relire » recharge le dossier.
Les champs du service voix, de whisper-server et de RVC sont dans Réglages › Voix, sous « Réglages avancés » ; son
état et « Lancer ou vérifier » restent devant.

- **Le service voix** : s'il ne répond pas, l'appli peut le lancer elle-même (`uv run service.py` dans le dossier
  choisi, ses arguments tirés des champs), sans console. Sa sortie va dans `voix.log`, vidé à chaque lancement, au
  dossier des journaux de l'appli (`%LOCALAPPDATA%\io.github.lun-ecosystem.luxuria\logs`). Un champ changé ne touche
  pas au service qui tourne : l'écran dit ce qu'il utilise et ce qui attend, et « Relancer le service » l'arrête puis le
  relance avec les champs. L'appli ne relance et n'arrête que celui qu'elle a lancé, et l'arrête avec elle.
- **whisper-server et RVC** : l'appli peut les lancer, au démarrage (un interrupteur chacun) ou à la main (« Lancer… »).
  Le `.exe` se choisit dans la boîte de dialogue du système et reste côté Rust (`programmes.json`, au dossier de
  configuration de l'appli) : la page ne nomme jamais de chemin. Il part dans son dossier, sans shell ni console, avec
  ses arguments un par ligne, et seulement si rien ne répond déjà à son adresse. Sa sortie va dans `whisper-server.log`
  ou `rvc.log`, vidés à chaque lancement. Rattaché à un job Windows, il s'arrête avec l'appli, même si elle plante,
  avec ce qu'il a ouvert lui-même : une fenêtre, ou un navigateur qui n'était pas déjà ouvert.
- **L'icône près de l'horloge** : elle dit l'un de trois états, disponible (l'icône), en sourdine (grise), injoignable
  (grise et pâle), avec l'état en infobulle. Un clic ramène la fenêtre ; son menu l'affiche, met ou lève la sourdine, et
  quitte comme la fermeture (la présence finit de la même façon).
- **Démarrer avec Windows** : l'interrupteur pose ou retire l'entrée de démarrage de la session (la clé `Run` de
  l'utilisateur). À l'ouverture, l'écran prend ce que Windows dit ; un refus s'affiche sous l'interrupteur, qui revient.

## Un tour de parole

`Endpointer` lit le micro par trames de 32 ms. À la courte pause, si « Répondre dès une courte pause » est actif, la
phrase est transcrite et envoyée, et sa réponse **se prépare sans se dire**. Si la personne reprend, la phrase est
retirée (`withdraw`). À la fin réelle, la réponse sort. Une prise de parole de plus de 400 ms pendant la réponse l'arrête,
et ce qui a été entendu remonte (`cut`).

Le filtre ne regarde qu'une phrase transcrite localement : refusée, elle ne part jamais.

« Autour de toi » (Réglages › Écoute) a trois préréglages : « Pièce calme », « Normal », les valeurs par défaut, et
« Bruit autour ». Ils ne remplissent que la fin de phrase et le seuil du silence (silence de fin, courte pause, durée
minimale, seuil en dB) ; une de ces valeurs changée à la main se lit « Personnalisé ». Les valeurs de « Pièce calme »
et de « Bruit autour » sont provisoires, à mesurer sur le poste réel.

## La sourdine

Le bouton lune de la scène, ou le raccourci global (`Control+Shift+M` par défaut, carte « La fenêtre »), la met ou
l'enlève. En sourdine, rien n'écoute : le micro est fermé, le champ du fil et la touche tenue ne font rien, et
l'étiquette dit « En sourdine ». Rien n'est dit, sauf une urgence quand « Les urgences » est activé dans « Ce qui est dit
à voix haute ». Elle dure jusqu'à ce qu'on l'enlève, même après un relancement ; l'enlever rend le micro dans son état
d'avant, et fermé pendant un appel. Un raccourci qui double celui de la scène ou la touche tenue est refusé.

Relié, la présence porte `muted: true` (pas de parole d'elle-même, pas d'accueil) et, « Les urgences » coupé,
`silentAnnounce: true` : une urgence non dite part en notification au lieu de se perdre. Les deux ne partent que vrais,
et un battement part tout de suite quand l'un change. Seul, la sourdine coupe le micro et le champ, c'est tout.

## Les deux cerveaux

`Brain` (`src/brain.ts`) est tout ce que le corps demande : `presence`, `send`, `cut`, `withdraw`, `thread`, `live`.

**Seul** (`src/local.ts`) : un appel `POST <adresse>/chat/completions` en flux par tour, les 30 derniers messages du jour
en contexte, découpés en phrases pour la voix. La voix ne lit pas le markdown (titres, puces, emphase, liens, code) ;
le fil le garde écrit. Le plafond est vérifié avant l'appel : la réponse qui le franchit va à son
terme, la suivante est refusée. Le fil ne garde que le jour courant. Une clé ne part jamais en clair hors du poste.

**Relié** (`src/core.ts`), entrant : `speech { id, n, text, why }` et `speech-end { id, why }` sur `GET /api/live`.
Sortant :

| Quand | Appel |
|---|---|
| Arrivée, présence, absence, départ | `POST /api/presence { state, busy?, ritual?, muted?, silentAnnounce?, tab }` ; `tab` est tiré par la page à son chargement, pour qu'un onglet fermé ne coupe pas la présence d'un autre ; le départ part à `pagehide` avec `keepalive`, une page rendue par l'historique du navigateur se ré-annonce, et un `beat` refusé (410 : la présence a fini pendant que la page dormait) aussi. Au retour au premier plan, un `beat`, jamais un `started`. L'absence de la fenêtre envoie `stopped`, et son retour un `started` |
| Une phrase | `POST /api/threads/main/messages { text, surface, confidence?, speak: true }` : flux `user`, `reply`, `delta`, `done` |
| Phrase continuée | `POST /api/threads/main/messages/:id/withdraw`, sur le message de la personne |
| Réponse coupée | `POST /api/threads/main/messages/:id/cut { said }`, sur la réponse ; vide si rien n'a été entendu |

## Le service voix

Il n'écoute que sur 127.0.0.1, et n'accepte que les pages de l'application : une autre origine ou un autre `Host` reçoit
un 403, car n'importe quel site ouvert dans le navigateur peut joindre 127.0.0.1. `--origin <url>` en ajoute une.

`GET /micro` lit dans le registre de Windows les applis qui tiennent le micro : une entrée ouverte compte si elle date
de moins de 12 h. Une entrée laissée ouverte par un plantage compte donc encore jusqu'à 12 h, et un appel de plus de
12 h ne compte plus. Les applis ignorées des Réglages restent le recours.

## Mesures

L'essai chronométré du 07/11 sur le poste réel : [`essai-2026-11-07.md`](essai-2026-11-07.md).

## Limites connues

- La voix est lue au niveau sonore, pas par Silero : à remplacer si l'essai montre de faux départs.
- Dans le navigateur, la touche ne marche que fenêtre active et le petit mode reste dans l'onglet : c'est la fenêtre qui
  les rend globaux.
- La détection d'une autre appli ne voit pas un autre onglet du navigateur. Dans la fenêtre, le micro est tenu par
  `msedgewebview2.exe`, ignoré comme un navigateur : une autre appli WebView2 (le nouveau Teams) échappe aussi.
- Sous WebView2, la liste des micros peut rendre des noms vides tant que l'accès n'a pas été donné une fois.
- La vignette au premier plan ne passe pas devant un jeu en plein écran exclusif.
- L'absence ne voit que le clavier et la souris : une manette ne compte pas comme une saisie (lun-luxuria#43).
- Filtre coupé, toute phrase lui est adressée et compte comme une saisie : une vidéo ou une autre personne gardent la
  présence. Le filtre du nom est ce qui les distingue.
- Les réglages de `tauri dev` et ceux de l'exe ne sont pas les mêmes (origines différentes) : à refaire une fois.
- Sans bord, la fenêtre se ferme par Alt+F4 ; la présence part alors comme à la fermeture d'un onglet.
- La clé du modèle reste dans le stockage de la page : le trousseau du système viendra plus tard.
- La page désigne elle-même le dossier du corps et celui du service voix, et le réseau de la fenêtre va à toute
  adresse (le serveur et le modèle sont libres). Une page compromise lirait donc les images d'un dossier qui a un
  `corps.json` et joindrait le réseau local sans CORS. Le durcissement serait un choix de dossier par dialogue natif,
  gardé côté Rust.
