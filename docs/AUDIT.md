# Audit — SolarCurve (état au 2026-07-28)

Périmètre analysé : `index.html` (280 lignes / 16 Ko), `app.js` (2097 lignes / 79 Ko), `styles.css` (790 lignes / 16 Ko), `readme.md` (81 lignes). Aucun autre fichier présent dans le dépôt (pas de `package.json`, `.gitignore`, `LICENSE`, ni code serveur pour les routes `/api/*`).

## 1. Qualité du code

**Lisibilité / conventions** — Le nommage est cohérent et explicite (`fetchFromPVGIS`, `buildMonthlyAverageProfile`, `azimuthSouthToAzimuthNorthClockwise`), le style `camelCase` est respecté partout, et des bannières `// ─── Section ───` découpent logiquement le fichier en 12 zones (DOM refs, State, Event Listeners, Input Parsing, API Fetching, Data Processing, Azimuth Conversion, Chart Rendering, Stats, Peak Shaving, Map, PDF Export). C'est le point fort du projet : malgré la taille, le code reste lisible ligne à ligne.

**Complexité cyclomatique** — Deux fonctions concentrent l'essentiel du risque :

- `exportToPDF()` (`app.js:1578-2068`, ~490 lignes) : construit 3 types de graphiques Chart.js hors-écran, capture la carte, puis dessine 4 pages de PDF avec des dizaines d'appels `doc.*` positionnés en coordonnées absolues. Une seule fonction fait à elle seule presque un quart du fichier.
- `captureMapForPDF()` (`app.js:1429-1575`, ~150 lignes) mélange minutage (`setTimeout` en cascade), manipulation Canvas 2D bas niveau et lecture de l'état Leaflet.

Ces deux fonctions sont difficiles à tester, à faire évoluer sans régression, et à relire en revue de code.

**Duplication (DRY)** —

- La construction des datasets Chart.js (courbe primaire / secondaire / somme) est dupliquée trois fois avec de légères variations : `buildDailyDatasets()` (`app.js:782-845`), `updateMonthlyChart()` (`app.js:869-892`), et à nouveau réimplémentée indépendamment dans `exportToPDF()` (`app.js:1670-1685`) avec des couleurs hexadécimales ré-écrites en dur (`'#f87171'`, `'#60a5fa'`, etc.) plutôt que réutilisées depuis la constante `CHART_COLORS` (`app.js:741-748`).
- `statCard()` est bien factorisé et réutilisé (bon point), mais le HTML des cartes "taux mensuel" du peak shaving (`app.js:1082-1091`) est construit par du CSS inline en chaîne de caractères, non réutilisable ailleurs.

**Couplage entre "modules" logiques** — Le fichier n'a aucune frontière de module : tout vit dans le même scope top-level (15 variables d'état `let`, ~35 références DOM `const`). N'importe quelle fonction peut lire/écrire n'importe quel état global. Le flag `syncingPowerFields` (`app.js:65`) est un garde de réentrance manuel entre les champs "puissance totale" et "répartition Wc" — signe classique d'un couplage trop fort entre des composants qui devraient être indépendants.

**Gestion des erreurs / cas limites** — Correcte au niveau "point d'entrée utilisateur" : `getInputs()` valide bornes et NaN (`app.js:377-411`), le `submit` handler et `optimizeWcSplit()` ont des `try/catch/finally`. En revanche, les échecs partiels sont silencieux : dans `fetchFromPVGIS`, une ligne horaire dont le parsing de date échoue est simplement ignorée (`app.js:559-562`) sans compteur ni avertissement — si l'API renvoie un format dégradé, l'utilisateur voit un résultat plausible mais faux, sans indice.

**Commentaires / documentation inline** — Quasi nuls en dehors des bannières de section. Les formules géographiques (`bearingBetweenPoints`, `destinationPoint`, `app.js:1377-1395`) et les conventions de signe d'azimut (Sud=0°, logique PVGIS vs PVWatts) mériteraient un commentaire d'une ligne rappelant la convention utilisée, car une erreur de signe ici est silencieuse et difficile à détecter visuellement.

## 2. Architecture

**Séparation des responsabilités** — Absente structurellement : un seul fichier gère à la fois accès DOM, état applicatif, appels réseau, conversion géométrique, agrégation de données, rendu de graphiques, rendu HTML de statistiques, logique métier (peak shaving, optimisation Wc) et génération de PDF. C'est un style "script" plutôt qu'une architecture en couches.

**Patterns** — Pas de pattern formalisé (pas de MVC/Observer/Module pattern explicite). Le "pattern" de fait est _procédural + écouteurs d'événements DOM directs_, ce qui reste défendable pour une petite app, mais a dépassé sa limite raisonnable à 2100 lignes.

**Modularité / réutilisabilité** — Nulle en l'état : rien n'est exporté, rien n'est testable unitairement sans charger tout `app.js` dans un DOM complet (JSDOM ou navigateur), y compris pour tester une fonction pure comme `aggregateDailyData()`.

**Dépendances externes** — 4 librairies chargées via CDN dans `index.html` (`index.html:9-17`) : Leaflet (CSS+JS, avec `integrity` + `crossorigin` ✅), Chart.js, jsPDF, html2canvas — ces 3 dernières **sans attribut `integrity`** (voir §5 Sécurité). Aucune version verrouillée par lockfile ; Chart.js pointe vers `@latest` implicite (`cdn.jsdelivr.net/npm/chart.js` sans version), ce qui signifie que l'application peut casser silencieusement à la prochaine release majeure de Chart.js.

## 3. Performance

**Poids et chargement** — Le point le plus impactant : **jsPDF (~350 Ko) et html2canvas (~200 Ko) sont chargés systématiquement au chargement de la page**, alors qu'ils ne servent qu'au clic sur "Exporter le rapport PDF" — une action minoritaire. Combinés à Chart.js (~200 Ko) et Leaflet (~150 Ko), c'est ~900 Ko de JS tiers téléchargés et parsés avant toute interaction, sur une page dont la fonctionnalité principale (tracer une courbe) n'en a besoin que pour moitié.

**Dépendance morte** — `html2canvas` (`index.html:17`, ~200 Ko) n'est en réalité **appelée nulle part** dans `app.js` : la capture de carte pour le PDF est faite "à la main" via un `<canvas>` 2D (`captureMapForPDF()`, `app.js:1429-1575`, commentaire explicite "Create canvas manually since html2canvas can't capture cross-origin tiles"). C'est ~200 Ko téléchargés et parsés sur chaque visite pour une librairie jamais invoquée — à supprimer purement et simplement, indépendamment du lazy-loading du reste.

**Rendu / manipulation DOM** — Bon réflexe déjà en place : les graphiques journalier et mensuel sont mis à jour via `chart.update()` plutôt que détruits/recréés (`app.js:768-773`, `896-901`). Incohérence relevée : le graphique de peak shaving, lui, est détruit puis recréé à chaque rafraîchissement (`app.js:1114-1116`) et enveloppé dans un `setTimeout(..., 100)` "pour laisser le DOM se stabiliser" (`app.js:1103-1105`) — un délai arbitraire plutôt qu'un séquencement garanti, symptomatique d'un bug de timing contourné plutôt que résolu.

**Lazy loading / code splitting** — Absent totalement : pas de bundler, donc pas de découpage possible. C'est directement lié à l'absence d'outillage de build (voir Mission 2).

## 4. Maintenabilité & scalabilité

**Ajout de fonctionnalité sans régression** — C'est le risque principal identifié. Toute nouvelle donnée à afficher (ex. un 3ᵈ azimut, une simulation de batterie) doit être répercutée manuellement à **au moins 5 endroits distincts** : le formulaire HTML, `getInputs()`, l'appel `fetchFromSource` dans le handler `submit`, la construction des datasets Chart.js (dupliquée ×2), le rendu des stats, et l'export PDF qui **réimplémente indépendamment** la logique d'agrégation/graphiques plutôt que de réutiliser les fonctions déjà écrites pour l'affichage à l'écran. Oublier un de ces points produit un bug silencieux (ex. PDF cohérent mais écran faux, ou l'inverse).

**Points de friction pour un futur développeur** —

1. Aucun point d'entrée modulaire : comprendre "où commence l'app" demande de lire les 2097 lignes.
2. Aucun test : toute modification doit être vérifiée manuellement dans un navigateur.
3. Pas de typage (JSDoc ou TypeScript) sur les objets `params` qui transitent entre 4-5 fonctions (`getInputs → fetchFromSource → fetchFromPVGIS/PVWatts`) — une faute de frappe sur une clé d'objet n'est détectée qu'à l'exécution.
4. Le dépôt ne contient **aucune implémentation des routes serveur `/api/pvgis` et `/api/pvwatts`** dont l'application dépend entièrement (`readme.md:39-43,73-79`) — un nouveau contributeur ne peut pas faire tourner l'app en local sans deviner/écrire ce proxy lui-même. C'est un angle mort de documentation autant que d'architecture.

## 5. Sécurité (frontend)

**Risques XSS** — Aucun `eval`/`Function()`. En revanche, `renderStats()`, `statCard()` et `updatePeakShavingDisplay()` construisent du HTML par concaténation de chaînes injectées via `innerHTML` (`app.js:966-1005`, `1093-1099`). Aujourd'hui les valeurs interpolées sont soit des libellés statiques soit des nombres formatés (`toFixed`), donc **pas d'injection exploitable en l'état**. Le pattern reste fragile : rien n'empêche un futur développeur d'y interpoler un message d'erreur ou une donnée renvoyée par l'API PVGIS/PVWatts sans échappement, ce qui ouvrirait une XSS DOM. Recommandation : `textContent` / construction DOM native, ou au minimum une fonction d'échappement centralisée.

**Intégrité des dépendances CDN** — Sur les 4 scripts tiers chargés, seul Leaflet a un attribut `integrity` (Subresource Integrity) (`index.html:11-17`). Chart.js, jsPDF et html2canvas sont chargés sans SRI : en cas de compromission du CDN (jsDelivr / cdnjs), du JS arbitraire s'exécuterait dans le contexte de la page avec accès complet au DOM et aux données saisies. À corriger en priorité (ajout de hash SRI, ou mieux : passage en dépendances npm bundlées, cf. Mission 2).

**Exposition de données côté client** — La clé API PVWatts (NREL) est saisie par l'utilisateur dans un champ texte simple (`type="text"`, `index.html:141`) et transmise en query string (`app.js:585` `api_key: pvwattsKey`) au proxy `/api/pvwatts`. Elle n'est pas persistée (pas de `localStorage`), ce qui est correct, mais transite en clair dans l'URL (visible dans les logs serveur, l'historique navigateur, un éventuel `Referer`). À minima, envisager un `POST` plutôt qu'un `GET` avec clé en query string côté proxy.

**Géolocalisation** — Correctement gardée derrière un clic utilisateur explicite (`app.js:193-211`), pas de tracking silencieux.

**CSP** — Aucune `Content-Security-Policy` définie (ni meta tag, ni recommandation de header dans le README), alors que la page charge 4 origines CDN distinctes + tuiles OpenStreetMap + 2 routes `/api/*`. À documenter au niveau du déploiement.

## Synthèse — sévérité

| #   | Constat                                                                                                                       | Sévérité | Effort de correction               |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------- |
| 1   | `app.js` monolithique (2097 lignes), aucune séparation des responsabilités                                                    | Élevée   | Élevé (refactor structurel)        |
| 2   | jsPDF (~350 Ko) chargé systématiquement au lieu d'à la demande ; html2canvas (~200 Ko) chargé alors qu'il n'est jamais appelé | Élevée   | Faible (lazy import + suppression) |
| 3   | Logique dupliquée entre affichage écran et export PDF (risque d'incohérence)                                                  | Élevée   | Moyen                              |
| 4   | 3 CDN sans SRI (Chart.js, jsPDF, html2canvas)                                                                                 | Moyenne  | Faible                             |
| 5   | Aucun test automatisé                                                                                                         | Moyenne  | Moyen                              |
| 6   | Aucun outillage (lint/format/build/CI)                                                                                        | Moyenne  | Faible                             |
| 7   | Dépôt sans le code du proxy `/api/*` dont l'app dépend, non documenté pour le dev local                                       | Moyenne  | Faible (documentation)             |
| 8   | `innerHTML` pour du rendu dynamique (pattern fragile, pas d'exploit actuel)                                                   | Faible   | Faible                             |
| 9   | Timing par `setTimeout` arbitraire pour le graphique peak shaving                                                             | Faible   | Faible                             |
