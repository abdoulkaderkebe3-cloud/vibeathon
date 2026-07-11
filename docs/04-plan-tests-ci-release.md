# 04 - Plan Tests / CI / Déploiement / Release (Étapes 5 à 8)

> Ces étapes sont anticipées dès le cadrage pour ne pas les découvrir le jour J.
> Le jury essaiera de casser la démo : un code qui "marche à la démo" n'est pas un code testé.

## Étape 5 - Tests

### Tests unitaires (fonctions critiques)
- **Calcul d'impact** : kWh / FCFA / CO2 à partir d'une conso évitée connue → résultat attendu.
- **Parseur de décision IA** : un JSON de décision valide est correctement interprété ; un JSON
  malformé est rejeté proprement (pas de crash).
- **Logique de priorité** : un appareil "essentiel" n'est jamais retenu comme candidat à la
  coupure (garantit CA4), même en heure de pointe.

### Tests d'intégration
- **Cycle complet simulé** : une prise mockée envoie une conso élevée → le backend appelle le
  brain (IA mockée) → l'actuator émet l'ordre "off" → l'état passe à off. Sans hardware.

### Recette utilisateur (contre les critères d'acceptation)
Le script de démo en 6 étapes EST la recette. Chaque étape valide un critère :
1. Mesure live → CA1
2. Pic bouilloire détecté → (entrée US2)
3. IA coupe la bouilloire, garde la lampe → CA2 + CA4
4. IA explique pourquoi → CA3
5. Page impact → CA5
6. Inclusion (SMS/voix) → US7 (bonus)

### IA générative pour les tests
Demander à un assistant IA de générer des cas de test limites (JSON de décision bizarres, conso
négative, appareil inconnu), puis les challenger à la main.

## Étape 6 - CI / Revue de code

- **Repo GitHub** créé et partagé avec l'équipe (prérequis, à faire tôt).
- **GitHub Actions** : à chaque push → install + lint + build + tests. La CI doit être verte
  avant toute démo. Une CI verte = preuve que le projet est livrable.
- **Revue de code** : PR même en solo (auto-revue à froid). Commits atomiques et clairs.
- **Lint / analyse statique** : ESLint + TypeScript strict sur backend et app.

## Étape 7 - Déploiement

- **Environnement de démo** : laptop maître + WiFi local créé par le boîtier (indépendant de
  la salle). Un seul écran de démo, un seul laptop maître (pas d'impro de branchement).
- **Config / secrets** : `.env` (gitignored) avec la clé OpenRouter, généré via `/generer-env`
  depuis le coffre `../../secrets/api-keys.md`. Un `.env.example` committable documente les noms.
- **Script de lancement unique** : démarrer backend (FastAPI) + app en une commande (pas de
  broker à lancer, le WebSocket est direct).
- **Plan de rollback** : vidéo de secours de la démo complète sur 2 téléphones (ADR-006).
  C'est la réponse à "et si le WiFi lâche ?".
- **Vérif conditions réelles** : répéter dans la salle si possible, tester la latence réseau.

## Étape 8 - Release & versioning

- **Semantic versioning** : la démo du jour J = **v1.0.0**.
- **Changelog** : liste claire de ce qui fonctionne, pour le jury et l'équipe.
- **Definition of done** (voir `01-besoin.md`) : CA1 à CA5 validés, CI verte, vidéo de secours
  prête, README rédigé.
- **Documentation de livraison** : `README.md` à la racine (pitch une phrase, architecture,
  comment lancer, ce qui marche, next steps).

## Checklist auto-évaluation express (du référentiel jury)

- [ ] Puis-je résumer le besoin en une phrase claire ?
- [ ] Mes critères d'acceptation sont-ils écrits et vérifiables ?
- [ ] Mon architecture est-elle documentée, même sommairement ?
- [ ] Ai-je relu et compris tout le code généré par l'IA ?
- [ ] Mes fonctionnalités critiques sont-elles testées ?
- [ ] Ma CI passe-t-elle au vert avant la démo ?
- [ ] Mon déploiement a-t-il un plan B (rollback) ?
- [ ] Ma version livrée a-t-elle un numéro et un changelog ?
