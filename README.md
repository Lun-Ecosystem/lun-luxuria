# Lun'Luxuria

Un compagnon vocal sur ton poste : tu lui parles, il te répond à voix haute, et le son ne quitte jamais ta machine.

Son nom, son ton et le modèle qui le fait répondre se règlent dans l'application. Il fonctionne de deux façons :

- **Seul** : il parle à un modèle compatible OpenAI, local (Ollama, llama.cpp) ou en ligne, avec un plafond de jetons
  par jour vérifié avant chaque appel.
- **Relié à un serveur** : le serveur décide de ce qui est dit et il ne fait que le dire, après un code d'appairage.

## Démarrer en local

```bash
npm install && npm run dev                                          # http://127.0.0.1:5180
uv run voix/service.py --stt faster:small --tts piper:<voix.onnx>   # dans un autre terminal
```

Puis les Réglages : l'adresse du modèle et son nom. Détails dans [`docs/README.md`](docs/README.md).

## Ce qui n'est pas dans ce dépôt

Ces briques s'installent à part, chacune sous sa propre licence, à vérifier selon ton usage :

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

## Licence

[MIT](LICENSE).
