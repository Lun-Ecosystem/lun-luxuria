<div align="center">

# Lun'Luxuria

**Un compagnon vocal sur ton poste : tu lui parles, il te répond à voix haute, et le son ne quitte jamais ta machine.**

Son nom, son ton et le modèle qui le fait répondre se règlent dans l'application.

[![CI](https://img.shields.io/github/actions/workflow/status/Lun-Ecosystem/lun-luxuria/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/Lun-Ecosystem/lun-luxuria/actions/workflows/ci.yml)
[![Licence](https://img.shields.io/github/license/Lun-Ecosystem/lun-luxuria?style=flat-square&label=licence)](LICENSE)
[![Node](https://img.shields.io/badge/node-%5E22.13%20%7C%7C%20%3E%3D24-5FA04E?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Svelte 5](https://img.shields.io/badge/svelte-5-FF3E00?style=flat-square&logo=svelte&logoColor=white)](https://svelte.dev)
[![Écosystème Lun'](https://img.shields.io/badge/%C3%A9cosyst%C3%A8me-Lun'-8A1E5A?style=flat-square)](https://crolix-website.vercel.app)

</div>

## Ce qu'il fait

- **Seul** : il parle à un modèle compatible OpenAI, local (Ollama, llama.cpp) ou en ligne, avec un plafond de jetons par
  jour vérifié avant chaque appel.
- **Relié à un serveur** : le serveur décide de ce qui est dit et il ne fait que le dire, après un code d'appairage.
- **Une vraie conversation** : tu peux le couper en pleine phrase, et il prépare sa réponse dès une courte pause, sans la
  dire tant que tu n'as pas fini.
- **Le micro t'appartient** : coupé, aucune capture ne tourne, et il ne se rallume jamais seul.

## Ce qu'il te faut

- Node `^22.13.0 || >=24` et [uv](https://docs.astral.sh/uv/) pour le service voix.
- Une voix, au choix : Piper ou Kokoro, et son modèle.
- Un modèle compatible OpenAI, ou un serveur auquel se relier.

## Démarrer en local

```bash
npm install && npm run dev                                          # http://127.0.0.1:5180
uv run voix/service.py --stt faster:small --tts piper:<voix.onnx>   # dans un autre terminal
```

Clique sur « Entrer », puis les Réglages : l'adresse du modèle et son nom. Détails dans [`docs/README.md`](docs/README.md).

## Si ça coince

| Ce que tu vois | Quoi faire |
|---|---|
| Tu n'entends rien | Un navigateur ne joue aucun son sans un clic : passer par « Entrer ». |
| Le modèle ne répond pas depuis la page | Il doit accepter les appels du navigateur. Ollama accepte 127.0.0.1, un autre peut demander de régler ses origines (CORS). |
| Le service voix répond 403 | Il n'accepte que les pages de l'application : ajouter l'adresse avec `--origin <url>`. |
| Il ne t'entend pas | Le micro reste coupé tant que son bouton ne l'a pas ouvert. |

## Dans l'écosystème

**Rôle dans l'écosystème** : satellite. Il possède sa scène, sa voix et ce qu'il écoute. Il fonctionne seul, ou se relie à
un serveur par `/api/live` et un code d'appairage. Relié, il ne décide de rien.

## Licences

Le code de ce dépôt est sous licence [MIT](LICENSE). Ces briques s'installent à part, chacune sous sa propre licence, à
vérifier selon ton usage :

| Brique | Rôle | Licence |
|---|---|---|
| [Piper](https://github.com/OHF-Voice/piper1-gpl) (`piper-tts`) | la voix, au choix | GPL-3.0-or-later |
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper), whisper.cpp | la transcription | MIT |
| Kokoro | la voix, au choix | Apache-2.0 |
| Un serveur RVC | le timbre, facultatif | selon le serveur |
| Live2D Cubism SDK, s'il vient un jour | l'image | propriétaire, jamais dans ce dépôt |

Une voix ou un modèle a aussi ses propres conditions : ce tableau ne vaut pas conseil juridique.

## Documentation

- [`docs/`](docs/) : ce que fait le projet aujourd'hui.
- Règles communes : [lun-docs](https://github.com/Lun-Ecosystem/lun-docs).

## Contribuer

Une branche, une PR avec critères de fin et preuves, CI verte. Seul CrOliX merge. Les règles viennent de
[lun-docs](https://github.com/Lun-Ecosystem/lun-docs).
