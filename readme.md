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
2. Exemple avec Python :

```bash
python -m http.server 8000
```

3. Ouvrir `http://localhost:8000`.

## Utilisation

1. Saisir latitude/longitude (ou bouton géolocalisation).
2. Saisir puissance, inclinaison, azimut et pertes.
3. Choisir la source de données :
	- PVGIS (par défaut)
	- PVWatts (si vous avez une clé API NREL)
4. Cliquer sur **Estimer la courbe annuelle**.

Résultats :
- Courbe **kWh/jour** sur 365 jours.
- Totaux annuels, moyenne journalière, meilleur et plus faible jour.

## Notes API

### PVGIS
- Gratuit, sans clé API.
- Endpoint utilisé : `https://re.jrc.ec.europa.eu/api/v5_3/seriescalc`
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


