# EcoWatt ⚡

> Un réseau de prises intelligentes piloté par IA qui mesure la consommation réelle, coupe le
> gaspillage et décale les usages hors des heures de pointe, en expliquant chaque décision.

Projet du **Vibeathon Côte d'Ivoire 2026** (secteur Énergie, 11 juillet 2026, CSCTICAO).
Équipe « Coding Team ». Lead technique : Kader.

## Le problème, la solution

Aucun foyer ivoirien ordinaire n'a de compteur intelligent : on gaspille sans le savoir, les
factures montent, et les pics en heure de pointe surchargent le réseau. EcoWatt fabrique un
compteur intelligent **accessible** : des prises (ESP32) qui mesurent chaque appareil, et une
IA qui coupe le gaspillage, décale les usages, prédit la facture et explique chaque décision.

## Fonctionnalités

- **Mesure temps réel** appareil par appareil, avec **auto-découverte** (une prise apparaît dès
  sa 1re mesure).
- **Cerveau IA** qui décide quoi couper/décaler en pondérant priorité, heure de pointe, budget et
  consommation, puis **explique** en langage clair.
- **Assistant conversationnel** (texte + voix) : questions libres, ordres (« coupe la
  bouilloire »), et **prédiction de facture** :
  - conversion **kWh ⇄ FCFA** au **barème progressif CIE** (social / général selon la conso) ;
  - **comparaison** avec le mois précédent ;
  - **compteur à carte / prépayé** : à partir des appareils et de leurs heures d'usage, estime
    combien de temps une recharge (ex. 1000 FCFA) va durer, et comment l'étirer.
- **Détection d'anomalie / sécurité** : quand un appareil consomme bien au-delà de la normale de
  son type (défaut probable : moteur, résistance, câblage), l'IA l'affiche en alerte et conseille de
  le faire vérifier, sans couper de force un appareil essentiel. Un risque de surchauffe évité.
- **Dashboard** temps réel (mode sombre, responsive) et bascule **démo / réel**.

## Le cerveau IA en 3 couches (conçu pour ne jamais tomber en démo)

Un hackathon a un réseau incertain et des quotas gratuits qui s'épuisent. L'IA d'EcoWatt est donc
**résiliente par construction**, du plus fiable au plus intelligent :

1. **Ordres déterministes** (`_parse_order`, sans LLM) : « coupe la prise 1 », « éteins tout »
   s'exécutent instantanément, gratuitement, hors ligne. Le relais physique répond toujours.
2. **Calculs exacts en Python** : tarif kWh⇄FCFA, prédiction de facture par appareil, prépayé.
   Ces chiffres sont **calculés, jamais inventés** par un modèle (aucune hallucination de prix).
3. **Cascade de 7 modèles à bascule automatique** pour la conversation libre : Groq (5 modèles,
   quota séparé par modèle) → Google Gemini (2 modèles). Un fournisseur sature (429) → on passe au
   suivant, **de façon invisible**. En dernier recours, repli sur des règles locales hors ligne.

## Architecture

```
[Prise ESP32]  --WiFi/WebSocket-->  [Backend FastAPI + SQLite]  --WebSocket-->  [App React]
 mesure + relais                     ingestion, cerveau IA, impact,              dashboard +
                                     prédiction facture, historique              assistant IA
```

La prise ESP32 réelle est un **serveur HTTP** que le backend interroge (`/data`, `/relay`) ; une
variante WebSocket et une variante Bluetooth existent aussi dans `firmware/`.

Détail : `docs/03-architecture.md`. Choix techniques : `docs/DECISIONS.md` (ADR-001 à 010).

## Démarrer en local

**Prérequis** : Python 3.10+, Node 20+.

**Backend** (API + IA) :
```bash
cd backend
python -m venv .venv && ./.venv/Scripts/pip install -r requirements.txt   # 1re fois
./.venv/Scripts/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```
→ API sur http://localhost:8000, doc interactive sur http://localhost:8000/docs

La clé IA (Groq) se met dans `backend/.env` (voir `backend/env.example`). Sans clé, le backend
tourne en mode dégradé (règles locales, hors ligne).

**Frontend** (dashboard) :
```bash
cd app
npm install     # 1re fois
npm run dev
```
→ http://localhost:5173

Brancher une vraie prise ESP32 : voir `docs/05-brancher-le-boitier.md`.

## Qualité

```bash
# Backend : lint + tests
cd backend
./.venv/Scripts/python -m ruff check .
./.venv/Scripts/python -m pytest -q        # 75 tests

# Frontend : tests + typecheck + build
cd app
npm test                                   # 48 tests (barème CIE, prédictions, anomalie, prépayé, courbe, helpers)
npm run build
```

Les tests front vérifient notamment que le **barème CIE côté client est le miroir fidèle du
backend** (100 kWh/mois ≈ 4 985 FCFA des deux côtés). Aucune vulnérabilité connue dans les
dépendances (`pip-audit`). L'**intégration continue** (GitHub Actions, `.github/workflows/ci.yml`)
rejoue lint + tests backend et tests + build frontend à chaque push / pull request.

## Structure du projet

| Chemin | Rôle |
|--------|------|
| `backend/` | API FastAPI + SQLite, cerveau IA (Groq), prédiction facture, WebSocket temps réel |
| `app/` | Dashboard + assistant IA (React / Vite / TypeScript / Tailwind) |
| `firmware/` | Code des prises ESP32 (mesure + relais, WiFi + variante Bluetooth) |
| `docs/` | Besoin, specs, architecture, plan tests/CI/release, impact, guide de branchement |
| `docs/DECISIONS.md` | Décisions techniques et leurs raisons (ADR) |

## Sécurité

Manipulation du **220V** : modules secteur uniquement, jamais de fil nu sous tension, montage
supervisé. Les **secrets** (clé API) vivent dans `backend/.env`, jamais versionné (`.gitignore`).

## Version

Pré-release. Objectif : **v1.0.0** le jour de la démo (changelog + definition of done).
