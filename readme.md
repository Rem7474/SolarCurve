# SolarCurve

Webapp statique pour estimer la production photovoltaïque quotidienne sur toute l'année selon :
- position GPS (latitude/longitude)
- puissance installée (kWc)
- inclinaison des panneaux (tilt)
- orientation des panneaux (azimut)
- pertes système

L'application utilise :
- **PVGIS** (priorité, idéal Europe/Corse)
- **PVWatts** en fallback (nécessite clé API NREL)

## Démarrage rapide

Option 1 (simple) :
1. Ouvrir `index.html` dans le navigateur.

Option 2 (recommandée, éviter certains soucis CORS selon navigateur) :
1. Lancer un serveur local depuis le dossier du projet.
2. Mini serveur Python avec CORS inclus :

```bash
python server.py
```

3. Ouvrir `http://127.0.0.1:8000`.

Option 3 (serveur Python standard) :

```bash
python -m http.server 8000
```

Puis ouvrir `http://localhost:8000`.

## Utilisation

1. Saisir latitude/longitude (ou bouton géolocalisation).
	- Vous pouvez aussi cliquer directement sur la carte pour positionner le point GPS.
2. Saisir puissance, inclinaison, azimut et pertes.
3. Choisir la source de données :
	- PVGIS (par défaut)
	- PVWatts (si vous avez une clé API NREL)
4. Cliquer sur **Estimer la courbe annuelle**.

Résultats :
- Courbe **kWh/jour** sur 365 jours.
- Slider mensuel (janvier → décembre) pour visualiser le **profil journalier horaire** moyen du mois sélectionné.
- Superposition des courbes limites : **21 juin** (été) et **21 décembre** (hiver).
- Totaux annuels, moyenne journalière, meilleur et plus faible jour.

## Notes API

L'application appelle d'abord des routes locales same-origin :
- `/api/pvgis`
- `/api/pvwatts`

Cela évite le blocage CORS côté navigateur. Le fichier `server.py` fournit ces routes en local.
Si ces routes n'existent pas en production, l'app tente un appel direct API (qui peut être bloqué par CORS selon le fournisseur).

Pour **PVGIS uniquement**, un fallback de secours est aussi tenté via :
- `https://api.allorigins.win/raw?url=...`

Ce fallback est pratique en test, mais non recommandé pour la production (dépendance tierce externe).

### PVGIS
- Gratuit, sans clé API.
- Endpoint utilisé : `https://re.jrc.ec.europa.eu/api/v5_3/seriescalc`
- Paramètre clé activé : `pvcalculation=1` (sinon PVGIS peut ne renvoyer que l'irradiation sans puissance PV `P`).
- Période calculée : année de référence 2020, pas horaire.
- Les données horaires sont agrégées en production quotidienne.

### PVWatts (fallback)
- Endpoint : `https://developer.nrel.gov/api/pvwatts/v8.json`
- Clé API gratuite requise (`api_key`).
- Timeframe `hourly`, puis agrégation en production quotidienne.

## Convention d'azimut

Pour garder un seul formulaire cohérent :
- **0° = Sud**,
- **-90° = Est**,
- **+90° = Ouest**,
- **±180° = Nord**.

La conversion interne est appliquée selon l'API choisie.

## Limites

- Estimation basée sur données météo historiques/modèles, pas une prévision en temps réel.
- Ne remplace pas une étude de dimensionnement détaillée.
- Les ombrages locaux fins ne sont pas modélisés ici.

## Déploiement production (important CORS)

Si vous déployez sur un domaine public (ex: `https://solar.remcorp.fr`), il faut exposer un proxy same-origin :
- `GET /api/pvgis` -> proxy vers `https://re.jrc.ec.europa.eu/api/v5_3/seriescalc`
- `GET /api/pvwatts` -> proxy vers `https://developer.nrel.gov/api/pvwatts/v8.json`

Sinon, l'appel direct navigateur peut être bloqué par la politique CORS de l'API distante.


