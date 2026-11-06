# Lun'Luxuria

> Projet de l'écosystème Lun'. Les règles communes (méthode, git, qualité, design) viennent du plugin
> `lun` et de [lun-docs](https://github.com/Lun-Ecosystem/lun-docs), qui font foi. Ce fichier ne garde
> que ce qui est propre à ce projet. 100 lignes maximum.

## Ce projet

- **Rôle** : un compagnon vocal public sur le poste de la personne, seul sur un modèle ou relié à un serveur (ADR 0010
  de lun-docs).
- **Possède** : le micro, la fin de phrase, le filtre, la voix, la lecture, la scène, ses réglages, et en mode seul son
  fil du jour et son plafond.
- **Ne possède pas, relié** : ce qui est dit (le serveur décide, Luxuria ne fait que dire), les cartes et les gestes
  (aucune logique de carte ici : une phrase part comme n'importe quelle autre), la mémoire.

## Lancer en local

```bash
npm install && npm run dev                                   # http://127.0.0.1:5180
uv run voix/service.py --stt faster:small --tts piper:<voix.onnx>   # dans un autre terminal
```

Prérequis : Node `^22.13.0 || >=24`, `uv`. Voir `docs/README.md`.

## Spécificités

- Dépôt public : aucun nom d'instance ici, ni dans le code ni dans la doc. Le nom, le ton et le contexte sont des réglages,
  et l'écran ne parle ni de core ni de ce à quoi il peut être relié (`src/noCore.test.ts`).
- Pour l'instant, une page Vite dans le navigateur. Tauri 2 viendra sur le desktop (Rust), sans toucher à `src/` sauf
  `audio.ts`, le raccourci global et la fenêtre.
- L'audio ne quitte jamais le PC : seuls du texte et des signaux en sortent.
- Le corps ne parle qu'à `Brain` (`src/brain.ts`) : ce qui marche seul marche relié, et l'inverse.
- Tout mécanisme de perception a son interrupteur dans `settings.ts` et sur l'écran Réglages, et ne dépend d'aucun autre.
- `src/lib/ui` et `src/lib/tokens.css` sont générés depuis lun-docs : `tools/sync-kit.mjs`, `tools/sync-tokens.mjs`.
- Les briques sous licence GPL ou propriétaire (Piper, Cubism) restent hors du dépôt, installées par la personne.
- La latence se mesure sur la machine réelle. Un chiffre pris ailleurs ne compte pas.
