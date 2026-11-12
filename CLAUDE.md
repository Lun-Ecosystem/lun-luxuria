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
  jamais de shell) et, à la demande, whisper-server et RVC (un .exe existant, choisi dans la boîte de dialogue du
  système et gardé côté Rust, sans shell, arrêté avec l'appli), dessiner l'icône de la barre selon l'état que dit la
  page, lire depuis quand la session n'a reçu ni touche ni souris (l'absence). Chaque permission de
  `src-tauri/capabilities/` est nommée ; aucune `:default` de plus sans raison.
- Le réseau dans la fenêtre : serveur et modèle par plugin-http, service voix par la page (CORS de `voix/service.py`).
  La CSP de `tauri.conf.json` suit tout nouvel appel ; `blob:` y sert au worklet du micro et aux images du corps.
- L'audio ne quitte jamais le PC : seuls du texte et des signaux en sortent.
- Le corps ne parle qu'à `Brain` (`src/brain.ts`) : ce qui marche seul marche relié, et l'inverse.
- Tout mécanisme de perception a son interrupteur dans `settings.ts` et sur l'écran Réglages, et ne dépend d'aucun autre.
- `src/lib/ui` et `src/lib/tokens.css` sont générés depuis lun-docs : `tools/sync-kit.mjs`, `tools/sync-tokens.mjs`.
- Les briques sous licence GPL ou propriétaire (Piper, Cubism) restent hors du dépôt, installées par la personne.
- La latence se mesure sur la machine réelle. Un chiffre pris ailleurs ne compte pas.
- L'écoute se rejoue : `npm run banc` passe chaque WAV de `../banc-sons` (ou `BANC_DIR`) dans la détection de voix, par le
  niveau puis par le modèle, et écrit `releve.md` dans ce dossier, avec à côté `deroule.jsonl`, le déroulé daté de sa
  chaîne (`src/trace.ts`). Aucun enregistrement de voix ni déroulé n'entre dans le dépôt.
- La présence se joue en scénarios (`src/presence/scenarios/`, données seules) sur les vrais mécanismes et des briques
  fausses, en temps virtuel, dans `npm test` ; un écart du code devient une issue et un `connus`, jamais une borne
  élargie. `npm run scenarios` écrit `releve-scenarios.md` et les `deroule-<nom>.jsonl` dans `BANC_DIR/scenarios`.
- `npm run mutations` mute le code au chargement (`tools/mutations.json`, `vitest.mutations.config.ts`, aucun fichier
  touché) et rejoue les scénarios : chaque mutation doit faire échouer son maillon. Un motif changé : la table suit.
- `npm run chaine` joue les scénarios sur la page construite dans Chrome, le service de voix et le serveur de la chaîne
  (`npm run chaine` de Lun'Anima, lancé avant), en temps réel ; il écrit `releve-chaine.md` et les
  `deroule-chaine-<nom>.jsonl` dans `BANC_DIR/chaine`. Sur le poste seulement, jamais en CI.
- La course, chaque scénario trente fois avec Hortense, puis la robustesse, deux fois par voix, jamais la sienne ; sous
  PowerShell, une commande par ligne (la variable reste dans la session : `Remove-Item Env:CHAINE_VOIX` avant une
  course) :

  ```powershell
  $env:CHAINE_REPETITIONS = '30'
  npm run chaine
  ```

  ```powershell
  $env:CHAINE_VOIX = 'julie,paul,piper:<piper.exe>|<fr_FR-upmc-medium.onnx>#jessica,piper:<piper.exe>|<fr_FR-upmc-medium.onnx>#pierre'
  $env:CHAINE_REPETITIONS = '2'
  npm run chaine
  ```

  Chaque partie ajoute sa ligne à `resultats.jsonl` ; la suite écrit `releve-taux.md` et des `deroule-chaine-<nom>-<k>.jsonl`.
  Seules les parties d'Hortense la font échouer, et l'erreur du joueur dans toute voix (`echoue`, `src/presence/taux.ts`).
- Le déroulé des derniers tours s'exporte par un bouton des réglages avancés de l'écoute, dans un onglet de navigateur
  seulement.
