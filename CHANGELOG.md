# Changelog

Toutes les évolutions notables d'EcoWatt sont consignées ici. Le format suit
[Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le projet le
[versionnement sémantique](https://semver.org/lang/fr/).

## [1.0.0] — 2026-07-11

Première version présentée au Vibeathon Côte d'Ivoire (secteur Énergie). Le cycle complet est couvert,
du besoin à la release, pas seulement le prototype.

### Ajouté

- **Prises intelligentes ESP32** : mesure de la consommation appareil par appareil (capteurs ACS712)
  et coupure par relais commandé, avec auto-découverte (une prise apparaît à sa première mesure).
- **Backend FastAPI + SQLite** : ingestion des mesures, décisions de l'IA expliquées en français,
  calcul d'impact (kWh, FCFA, CO2), historique, temps réel par WebSocket.
- **Cerveau IA en trois couches, conçu pour ne jamais tomber en démo** : ordres déterministes sans
  modèle (instantanés, hors ligne), calculs de facture exacts en Python, et conversation libre servie
  par une cascade de sept modèles (cinq Groq, deux Gemini) qui bascule seule quand un quota s'épuise.
- **Prédiction de facture au barème progressif réel de la CIE** (tarif social puis général), estimation
  de la durée d'une recharge de compteur à carte, et classement des appareils par coût projeté.
- **Application React** : tableau de bord temps réel, assistant conversationnel (texte et voix),
  pilotage direct des prises, thème clair et sombre, responsive.
- **Version vitrine** pour la soumission en ligne : démo 100 % navigateur, aucune prise pilotable à
  distance, chat servi par une fonction serverless qui n'expose jamais la clé.
- **Fonctionnement hors ligne** : l'application s'installe sur l'écran d'accueil et s'ouvre sans réseau
  (service worker).
- **Qualité** : intégration continue GitHub Actions (lint, typecheck, tests, builds), 53 tests backend
  et 26 tests front, zéro dépendance vulnérable connue.

### Performances

- JavaScript critique réduit de 238 à 127 ko gzippé (recharts remplacé par des graphes SVG maison).
- Plus aucune dépendance à un domaine tiers (polices auto-hébergées) : premier affichage plus rapide
  et robuste sur réseau saturé ou derrière un portail captif.

### Sécurité

- Aucun secret dans le dépôt ; clés d'API en variables d'environnement, `.env` hors du versionnement.
- La version en ligne n'expose ni le backend ni le matériel : la clé du chat vitrine reste côté serveur.

[1.0.0]: https://github.com/  <!-- lien du dépôt à compléter avant publication -->