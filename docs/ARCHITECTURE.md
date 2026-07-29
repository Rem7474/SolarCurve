# Architecture cible — SolarCurve

Objectif : garder une **webapp statique vanilla JS**, sans framework UI, mais avec un outillage moderne pragmatique adapté à un projet solo/petite équipe. Aucune sur-architecture : pas de React/Vue (le volume de manipulation DOM ne le justifie pas), pas de TypeScript complet (JSDoc suffit pour ce périmètre), pas de CSS-in-JS.

## 2.1 Arborescence cible

```
SolarCurve/
├── index.html                     # point d'entrée Vite (racine, <script type="module" src="/src/main.js">)
├── package.json
├── vite.config.js                 # config Vite + Vitest (test: {...})
├── eslint.config.js                # flat config ESLint 9
├── .prettierrc.json
├── .prettierignore
├── .gitignore
├── src/
│   ├── main.js                    # bootstrap : câble les event listeners, orchestre les modules
│   ├── dom.js                     # toutes les références DOM (source unique)
│   ├── state.js                   # état mutable partagé (remplace les `let` globaux)
│   ├── core/                      # logique pure, sans DOM, 100% testable
│   │   ├── geo.js                 # bearingBetweenPoints, destinationPoint
│   │   ├── azimuth.js             # conversions d'azimut (sud↔nord, opposé, normalisation)
│   │   └── solar-data.js          # agrégation horaire→journalier→mensuel, split Wc
│   ├── api/                       # accès réseau, isolé du DOM
│   │   ├── client.js              # fetchJSONFromAPI, dispatcher fetchFromSource
│   │   ├── pvgis.js               # fetchFromPVGIS, parsePVGISTime
│   │   └── pvwatts.js             # fetchFromPVWatts
│   ├── ui/                        # DOM, découpé par domaine fonctionnel
│   │   ├── form.js                # getInputs, validation, sync Wc/azimut2
│   │   ├── status.js              # setStatus, toggleLoading, show/hideResults
│   │   ├── sidebar.js             # toggle sidebar mobile
│   │   ├── charts.js              # charts journalier/mensuel + construction datasets partagée
│   │   ├── stats.js               # renderStats, statCard
│   │   ├── peak-shaving.js        # updatePeakShavingDisplay, renderPeakShavingChart
│   │   ├── map.js                 # carte Leaflet, marker, flèche d'azimut draggable
│   │   └── pdf-export.js          # export PDF (jsPDF/html2canvas chargés en lazy import)
│   └── styles/
│       ├── main.css                # point d'entrée, importe les partials ci-dessous
│       ├── tokens.css               # :root — couleurs, espacements, rayons, ombres
│       ├── base.css                 # reset, body
│       ├── layout.css               # app-wrapper, sidebar, main-content, responsive
│       └── components/
│           ├── buttons.css
│           ├── forms.css
│           ├── cards.css
│           └── charts.css
├── tests/
│   └── core/
│       ├── geo.test.js
│       ├── azimuth.test.js
│       └── solar-data.test.js
├── docs/
│   ├── AUDIT.md
│   └── ARCHITECTURE.md
├── .github/
│   └── workflows/
│       └── ci.yml
└── readme.md
```

~16 fichiers JS au lieu d'un seul : granularité choisie par **domaine fonctionnel** (pas "un fichier par fonction", ce qui serait de la sur-architecture pour ce périmètre). `core/` et `api/` n'ont aucune dépendance au DOM : ce sont les seuls modules couverts par des tests unitaires dans un premier temps — c'est le rapport effort/valeur le plus favorable.

## 2.2 Choix technologiques

| Outil        | Choix                                                              | Justification                                                                                                                                                                                                                                                                                                                    |
| ------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bundler      | **Vite**                                                           | Zéro config lourde, dev server ESM natif + HMR, `import()` dynamique natif (indispensable pour lazy-load jsPDF/html2canvas), build de prod avec hashing de cache automatique. Produit toujours un site 100% statique déployable tel quel — cohérent avec la nature de l'app.                                                     |
| Lint         | **ESLint** (flat config, `eslint:recommended` + règles JS de base) | Détecte immédiatement les bugs de portée qui vont apparaître en éclatant un fichier à état global partagé en modules (variables non définies, imports manquants). Pas de plugin framework nécessaire (vanilla JS).                                                                                                               |
| Format       | **Prettier**                                                       | Élimine les débats de style, `--check` en CI, zéro configuration custom nécessaire.                                                                                                                                                                                                                                              |
| Tests        | **Vitest**                                                         | Partage la pipeline de transformation avec Vite (pas de config Babel/webpack séparée), API compatible Jest, rapide. Utilisé d'abord sur `core/` (fonctions pures) où le ROI est immédiat ; extension possible à `ui/` avec `jsdom` plus tard si besoin.                                                                          |
| TypeScript   | **Non retenu pour l'instant**                                      | Le projet est petit, solo/small team, et le gain d'un typage strict est inférieur au coût de migration complète. Recommandation intermédiaire : JSDoc `@typedef` sur les objets qui transitent entre couches (`params` de `getInputs()` → `fetchFromSource`) pour bénéficier de l'autocomplétion/vérification IDE sans build TS. |
| Framework UI | **Non retenu**                                                     | Le volume de manipulation DOM ne justifie pas React/Vue ; le découpage en modules ES + un `state.js` minimal résout le problème de couplage sans réécriture complète.                                                                                                                                                            |
| CSS          | **CSS natif + custom properties**, juste splitté en partials       | Déjà un bon niveau de maturité (tokens en `:root`) ; Sass/PostCSS ajouterait un coût de build pour un gain marginal à cette taille.                                                                                                                                                                                              |

## 2.3 Refactoring prioritaire (impact vs effort)

| #   | Action                                                                                                                            | Impact                                                                | Effort                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------- |
| 1   | Lazy-load `jsPDF` via `import()` dynamique au clic sur "Export PDF" ; suppression de `html2canvas` (jamais appelé, cf. audit)     | Élevé (perf, ~550 Ko retirés du chargement initial)                   | Faible                                  |
| 2   | Éclater `app.js` en modules `core/` / `api/` / `ui/`                                                                              | Élevé (maintenabilité, testabilité)                                   | Élevé — mais fondation de tout le reste |
| 3   | Remplacer les 4 `<script>` CDN par des dépendances npm bundlées                                                                   | Élevé (sécurité — supprime le risque SRI manquant — + perf)           | Moyen                                   |
| 4   | Unifier la construction des datasets Chart.js (une seule fonction réutilisée par graphique journalier, mensuel **et** export PDF) | Élevé (supprime la triplication et le risque d'incohérence écran/PDF) | Moyen                                   |
| 5   | Tests Vitest sur `core/` (fonctions déjà pures)                                                                                   | Moyen-élevé (filet de sécurité pour les refactors suivants)           | Faible                                  |
| 6   | ESLint + Prettier + CI (gate sur push/PR)                                                                                         | Moyen (empêche les régressions de style/qualité de passer)            | Faible                                  |
| 7   | Avertir l'utilisateur si une part significative des lignes horaires PVGIS/PVWatts est droppée au parsing                          | Moyen (fiabilité des données affichées)                               | Faible                                  |
| 8   | Remplacer les `innerHTML` de `stats.js`/`peak-shaving.js` par de la construction DOM native                                       | Moyen (durcissement XSS, pas d'exploit actuel connu)                  | Faible                                  |
| 9   | Documenter/scaffolder le proxy `/api/*` manquant (contrat d'API minimal ou plugin de dev Vite)                                    | Moyen (onboarding développeur)                                        | Faible-moyen                            |
| 10  | Splitter `styles.css` en partials (`tokens`/`base`/`layout`/`components/*`)                                                       | Faible-moyen                                                          | Faible                                  |

## 2.4 Plan de migration progressif

Chaque étape est un commit indépendant et réversible ; l'application reste fonctionnelle et déployable à l'identique après chaque étape (pas de "big bang").

1. **Outillage sans toucher au code** — `package.json`, ESLint, Prettier, `.gitignore`. Aucun changement fonctionnel.
2. **Bascule Vite "no-op"** — `index.html` pointe vers `/src/main.js` ; dans un premier temps le contenu est quasi identique à `app.js` (juste déplacé), CDN remplacés par imports npm. Vérification : `npm run dev` et `npm run build` produisent un rendu identique à la version actuelle.
3. **Extraction des fonctions pures** (`core/geo.js`, `core/azimuth.js`, `core/solar-data.js`) — aucun effet de bord DOM, donc risque de régression minimal, et immédiatement couvrables par Vitest.
4. **Extraction de la couche API** (`api/client.js`, `api/pvgis.js`, `api/pvwatts.js`).
5. **Extraction de la couche UI par domaine** (`form`, `status`, `map`, `charts`, `stats`, `peak-shaving`), `main.js` devenant le seul orchestrateur qui importe et câble les écouteurs d'événements.
6. **Extraction de l'export PDF en dernier** (zone la plus risquée du fichier d'origine), avec lazy-loading des dépendances.
7. **Activation de la CI** une fois lint/format/tests/build stables en local.
8. **Split CSS en partials** — non bloquant, réalisable en parallèle de n'importe quelle étape ci-dessus.

Ce document sert de référence ; la mise en œuvre (Mission 3) suit cet ordre.
