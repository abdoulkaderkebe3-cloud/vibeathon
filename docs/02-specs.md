# 02 - Spécifications fonctionnelles & techniques (Étape 2/8)

> Traduire le besoin en exigences précises et non ambiguës.
> Livrable jury : périmètre MVP (IN/OUT), stack justifiée, contraintes non-fonctionnelles,
> priorisation MoSCoW.

## Périmètre du MVP (IN / OUT)

**IN (dans la démo)**
- 2 prises intelligentes qui mesurent la puissance et coupent leur appareil.
- Dashboard temps réel : conso par appareil, liste des appareils, log des décisions IA.
- Cerveau IA qui décide de couper un appareil non essentiel en heure de pointe et l'explique.
- Priorité des appareils (essentiel / reportable / confort).
- Page impact : kWh, FCFA, CO2 économisés, calculés dynamiquement.

**OUT (hors périmètre hackathon, à dire au jury comme "next steps")**
- App mobile native (le dashboard web suffit pour la démo).
- Multi-foyers, comptes utilisateurs, authentification.
- Intégration réelle avec la CIE / SODECI.
- Estimation calibrée des appareils non branchés (mentionnée au pitch, pas codée).

## Priorisation MoSCoW

| Priorité | Éléments |
|----------|----------|
| **Must** | Mesure temps réel (2 prises), coupure commandée par l'IA, explication de la décision, dashboard live, calcul d'impact, priorité "essentiel jamais coupé" |
| **Should** | Décalage d'usage (couper puis replanifier un rallumage), heure de pointe paramétrable |
| **Could** | Alerte SMS/voix (inclusion), budget cible avec délestage, estimation appareils non branchés |
| **Won't** (cette fois) | App mobile native, multi-foyers, comptes utilisateurs, intégration CIE |

## Stack technique et justification

Voir les ADR dans `DECISIONS.md` (même dossier) pour le détail et le statut.

| Couche | Choix proposé | Justification courte |
|--------|---------------|----------------------|
| Prises / firmware | ESP32 + capteur de courant + relais (sur mesure) | Coût maîtrisé (budget nul), contrôle total, formateur |
| Communication | WebSocket direct ESP32 ↔ FastAPI (sans broker) | Bidirectionnel, temps réel, zéro infra à lancer |
| Backend | Python + FastAPI + SQLite | Prototypage rapide, WebSocket natif, persistance simple |
| App / dashboard | React 19 + Vite + TypeScript + Tailwind | Stack maîtrisée, itération rapide |
| IA | DeepSeek V3 (gratuit) via OpenRouter, sortie JSON | Pondération multi-facteurs + explication = "vraie IA", budget nul |

## Contraintes non-fonctionnelles (NFR)

- **Fiabilité (priorité n°1)** : la démo doit passer 3 fois d'affilée sans intervention
  manuelle (critère Go/No-Go du J-1). Tout tourne en réseau local ; vidéo de secours en plan B.
- **Performance** : mesure → affichage < 2 s (CA1) ; décision IA < 5 s pour rester fluide en démo.
- **Résilience internet** : seule dépendance externe = OpenRouter (DeepSeek V3). Prévoir un mode dégradé
  (dernière décision en cache, ou règle simple de repli) si le réseau lâche pendant la démo.
- **Sécurité 220V** : modules secteur, jamais de fil nu, supervision (voir la section Sécurité du README).
- **Sécurité logicielle** : clé OpenRouter dans `.env` gitignored (via `/generer-env`), jamais
  en dur, jamais commitée, jamais loggée en clair.
- **Accessibilité / inclusion** : dimension du thème ; alerte SMS/voix en Could pour couvrir
  l'utilisateur sans smartphone.

## Interfaces (contrats de données, détaillés dans 03-architecture.md)

- Prise → backend : `{ prise_id, watts, timestamp }`.
- Backend → IA : `{ appareils[], heure, budget?, heure_pointe }`.
- IA → backend : `{ action: "couper"|"rallumer"|"garder", device_id, raison, replanifie_a? }`.
- Backend → prise : `{ prise_id, relais: "on"|"off" }`.
- Backend → app (WebSocket) : état complet (appareils + mesures + dernières décisions + impact).
