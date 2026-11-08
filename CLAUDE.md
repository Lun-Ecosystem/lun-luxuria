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
- Une page Vite, servie au navigateur ou dans la fenêtre Tauri 2 (`src-tauri/`, Windows). Ce qui n'existe que dans la
  fenêtre vit dans `src/desktop/` et ne s'active que si `inWindow` ; la page dans le navigateur reste entière.
- Côté Rust, le moins possible : lire le dossier du corps (borné à ce dossier), lancer le service voix (programme fixe,
  jamais de shell) et, à la demande, whisper-server et RVC (un .exe existant, nommé dans les réglages, sans shell, arrêté à la sortie), dessiner l'icône de la barre selon l'état que dit la page. Chaque permission de `src-tauri/capabilities/` est nommée ; aucune `:default` de plus sans raison.
- Le réseau dans la fenêtre : serveur et modèle par plugin-http, service voix par la page (CORS de `voix/service.py`).
  La CSP de `tauri.conf.json` suit tout nouvel appel ; `blob:` y sert au worklet du micro et aux images du corps.
- L'audio ne quitte jamais le PC : seuls du texte et des signaux en sortent.
- Le corps ne parle qu'à `Brain` (`src/brain.ts`) : ce qui marche seul marche relié, et l'inverse.
- Tout mécanisme de perception a son interrupteur dans `settings.ts` et sur l'écran Réglages, et ne dépend d'aucun autre.
- `src/lib/ui` et `src/lib/tokens.css` sont générés depuis lun-docs : `tools/sync-kit.mjs`, `tools/sync-tokens.mjs`.
- Les briques sous licence GPL ou propriétaire (Piper, Cubism) restent hors du dépôt, installées par la personne.
- La latence se mesure sur la machine réelle. Un chiffre pris ailleurs ne compte pas.
