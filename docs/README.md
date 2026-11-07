# Lun'Luxuria

## Lancer

1. La voix : `uv run voix/service.py --stt faster:small --tts piper:<voix.onnx> [--rvc <url>]`. Autres briques :
   `--stt whisper-server:<url>` (whisper.cpp par Vulkan), `--tts kokoro:<modèle.onnx>:<voix.bin>`. `--lang` règle la
   langue transcrite (`fr` par défaut).
   - **Confiance** : avec faster-whisper, l'exponentielle de la moyenne d'`avg_logprob`, qui compte aussi horodatages
     et fin de texte. Avec whisper-server, la moyenne géométrique des probabilités des seuls jetons de texte
     (`verbose_json`), car son `avg_logprob` divise par un compte qui inclut les jetons spéciaux. Les deux ne se
     comparent pas : la barre de geste se juge sur la brique en service. Sans aucun mot, la confiance vaut 0.
   - **RVC** : 50 ms de silence devant, puis des blocs de 0,5 s à 48 kHz, un appel à la fois. Le service rend la phrase
     entière, à sa longueur utile. `--rvc-gain` règle le gain de sortie (2,0 par défaut), borné à [-1, 1].
2. L'app : `npm run dev`, puis http://127.0.0.1:5180, et « Entrer » : un navigateur ne joue aucun son sans un clic.
3. Son cerveau, au choix :
   - **Seul** : dans les Réglages, l'adresse d'un service compatible OpenAI et le nom du modèle. Le service doit accepter
     les appels du navigateur : Ollama accepte 127.0.0.1, un autre peut demander de régler ses origines (CORS).
   - **Relié** : un serveur joignable par `CORE_URL` (8788 par défaut) et son code d'appairage. Dans l'écosystème Lun',
     c'est le core : `npm run pair-code` dans lun-anima, et pour un essai un core jetable avec son propre `DB_PATH`.

Le micro reste coupé tant que le bouton ne l'a pas ouvert. Coupé, aucune capture ne tourne, et il ne se rallume jamais seul.

## Un tour de parole

`Endpointer` lit le micro par trames de 32 ms. À la courte pause, si « Répondre dès une courte pause » est actif, la
phrase est transcrite et envoyée, et sa réponse **se prépare sans se dire**. Si la personne reprend, la phrase est
retirée (`withdraw`). À la fin réelle, la réponse sort. Une prise de parole de plus de 400 ms pendant la réponse l'arrête,
et ce qui a été entendu remonte (`cut`).

Le filtre ne regarde qu'une phrase transcrite localement : refusée, elle ne part jamais.

## Les deux cerveaux

`Brain` (`src/brain.ts`) est tout ce que le corps demande : `presence`, `send`, `cut`, `withdraw`, `thread`, `live`.

**Seul** (`src/local.ts`) : un appel `POST <adresse>/chat/completions` en flux par tour, les 30 derniers messages du jour
en contexte, découpés en phrases pour la voix. Le plafond est vérifié avant l'appel : la réponse qui le franchit va à son
terme, la suivante est refusée. Le fil ne garde que le jour courant. Une clé ne part jamais en clair hors du poste.

**Relié** (`src/core.ts`), entrant : `speech { id, n, text, why }` et `speech-end { id, why }` sur `GET /api/live`.
Sortant :

| Quand | Appel |
|---|---|
| Arrivée, présence, départ | `POST /api/presence { state, busy?, ritual? }` ; le départ part à `pagehide` avec `keepalive`, et une page rendue par l'historique du navigateur se ré-annonce |
| Une phrase | `POST /api/threads/main/messages { text, surface, confidence?, speak: true }` : flux `user`, `reply`, `delta`, `done` |
| Phrase continuée | `POST /api/threads/main/messages/:id/withdraw`, sur le message de la personne |
| Réponse coupée | `POST /api/threads/main/messages/:id/cut { said }`, sur la réponse ; vide si rien n'a été entendu |

## Le service voix

Il n'écoute que sur 127.0.0.1, et n'accepte que les pages de l'application : une autre origine ou un autre `Host` reçoit
un 403, car n'importe quel site ouvert dans le navigateur peut joindre 127.0.0.1. `--origin <url>` en ajoute une.

## Mesures

L'essai chronométré du 07/11 sur le poste réel : [`essai-2026-11-07.md`](essai-2026-11-07.md).

## Limites connues

- La voix est lue au niveau sonore, pas par Silero : à remplacer si l'essai montre de faux départs.
- La touche ne marche que fenêtre active, et la détection d'une autre appli ne voit pas un autre onglet du navigateur :
  le raccourci global et le vrai nom de l'appli viennent avec Tauri.
- Le petit mode n'est pas encore une fenêtre au premier plan.
- La clé du modèle reste dans le stockage du navigateur : le trousseau du système viendra avec Tauri.
