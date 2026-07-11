# DECISIONS.md — Architecture Decision Records (EcoWatt)

> Journal des décisions techniques structurantes (étape 3 « Conception / architecture » du cycle
> de vie logiciel). Chaque décision : contexte, choix, raison. Statut ✅ = actée.

---

## ADR-001 — Prises sur mesure : ESP32 + capteur de courant + relais ✅

**Contexte** : chaque prise doit mesurer la consommation de son appareil et pouvoir le couper, en WiFi.

**Choix** : une carte ESP32 + capteur de courant + module relais par prise, plutôt qu'un module
secteur prêt à l'emploi.

**Raison** : budget maîtrisé (pas d'achat de matériel propriétaire), contrôle total du firmware,
valeur pédagogique. **Sécurité 220V** : uniquement des modules conçus pour le secteur, montage supervisé.

---

## ADR-002 — La prise est un serveur HTTP interrogé par le backend ✅

**Contexte** : transport prises ↔ backend, sur un réseau de salle réputé peu fiable.

**Choix** : l'ESP32 expose un petit serveur HTTP (`/data` pour les mesures, `/relay` pour les ordres)
que le backend interroge en boucle. Le WiFi est créé par le boîtier, indépendant de la salle. Des
variantes WebSocket et Bluetooth (BLE) existent aussi dans `firmware/`.

**Raison** : aucun broker à installer, un point de panne en moins le jour J, format simple à déboguer.

---

## ADR-003 — Backend Python + FastAPI ✅

**Choix** : FastAPI (WebSocket natif, validation Pydantic).

**Raison** : prototypage rapide, temps réel vers l'app, et validation typée des décisions de l'IA.

---

## ADR-004 — Persistance SQLite ✅

**Choix** : SQLite (fichier local) via SQLModel. On persiste appareils, mesures et décisions ; l'état
« live » reste en mémoire pour la réactivité. Base en mode WAL (lecteurs + écrivain concurrents).

**Raison** : historique (graphe dans le temps + prédiction) sans serveur de base à lancer.

---

## ADR-005 — Cerveau IA résilient en 3 couches ✅

**Contexte** : réseau incertain et quotas gratuits limités ; la démo ne doit **jamais** tomber.

**Choix** : une IA résiliente par construction, du plus fiable au plus intelligent.

1. **Ordres déterministes sans LLM** (couper / rallumer / « tout ») : instantanés, gratuits, hors ligne.
2. **Calculs exacts en Python** (tarif kWh⇄FCFA, prédiction de facture, prépayé) : chiffres **calculés,
   jamais inventés** par un modèle.
3. **Conversation libre par cascade de modèles gratuits** à bascule automatique (Groq, plusieurs
   modèles → Google Gemini), avec **tool calling** pour agir, et **repli sur règles locales** hors ligne.

**Raison** : prouver de la vraie IA (pondération multi-facteurs, explication, action réelle) sans
sacrifier la fiabilité de la démo.

**Note** : un modèle n'est réputé disponible que si un **appel réel** réussit, tool calling compris ;
le catalogue des modèles d'un fournisseur n'est pas une garantie.

---

## ADR-006 — Prix du kWh = barème progressif CIE (source unique) ✅

**Contexte** : convertir kWh ⇄ FCFA et chiffrer les économies **honnêtement**.

**Choix** : modéliser le barème progressif CIE (Tarif Social ≤ 100 kWh/mois, Tarif Général au-delà)
comme **structure de données unique**. Il sert la conversion, la prédiction de facture et le prépayé.
Les **économies sont valorisées au prix marginal** du foyer, cohérent avec la facture affichée : un seul
prix du kWh dans toute l'application (économies ⇄ facture).

**Raison** : le prix marginal est le vrai levier d'économie ; une source unique garantit des chiffres
cohérents. Montants du barème à confirmer sur une facture CIE réelle.

---

## ADR-007 — Prédiction de facture par appareil, sur les mesures réelles ✅

**Choix** : intégrer les watts dans le temps (méthode des trapèzes, plafond d'intervalle) pour
reconstruire l'énergie **kWh/jour par appareil**, puis sa **part de facture mensuelle** projetée sous
le barème. Exposé en API et dans le dashboard (carte « Prévision de facture »).

**Raison** : « sur ce que ton boîtier a réellement mesuré, voici l'appareil qui pèsera le plus » est
bien plus fort qu'une prédiction sur des chiffres saisis à la main.

---

## ADR-008 — Application légère et utilisable hors ligne (contexte ivoirien) ✅

**Contexte** : usage sur smartphone, forfait data compté, connexion souvent à 300–500 kb/s.

**Choix** : réduire le JavaScript critique (graphes SVG maison plutôt qu'une librairie lourde), polices
**auto-hébergées** (zéro hôte tiers), et **PWA** installable et fonctionnelle hors ligne.

**Raison** : défendre « conçu pour l'Afrique » par la preuve. Mesuré : ~127 ko de JS gzip, l'app
s'affiche réseau totalement coupé.

---

## ADR-009 — Deux builds : vitrine publique, version complète locale ✅

**Contexte** : une IA de présélection charge l'URL publique ; la démonstration devant le jury se fait
en local avec le boîtier. L'API n'a pas d'authentification.

**Choix** : une seule base de code, deux builds.

- **Version complète (local)** : pilotage réel du boîtier, bascule démo/réel.
- **Vitrine (en ligne)** : mode démo forcé, **aucune prise pilotable depuis Internet** ; la conversation
  passe par une fonction serverless qui relaie vers le LLM **sans exposer la clé** dans le bundle.

**Raison** : personne ne doit pouvoir couper une prise réelle depuis Internet, et la clé API ne doit
jamais quitter le serveur.

---

## ADR-010 — Qualité vérifiable (le code fait partie de l'évaluation) ✅

**Choix** : typage strict (TypeScript, Pydantic), lint (`ruff` + ESLint), **79 tests automatisés**
(53 backend + 26 frontend, dont la parité du barème CIE client ⇄ serveur), et **CI GitHub Actions**
(lint + tests + builds à chaque push / pull request).

**Raison** : la qualité des sources est un critère à part entière ; un projet linté, testé et à CI
verte est le signal de rigueur le plus visible à l'ouverture du code.
