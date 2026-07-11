# 01 - Expression de besoin (Étape 1/8)

> Comprendre le problème avant d'écrire une ligne de code.
> Livrable jury : user stories + critères d'acceptation mesurables.

## Problème (une phrase)

On gaspille de l'électricité sans le savoir : aucun foyer ivoirien ordinaire n'a de compteur
intelligent, personne ne sait ce qui consomme vraiment chez lui, les pics en heure de pointe
surchargent le réseau, et l'électricité venant surtout du gaz, chaque kWh gaspillé est du CO2
émis pour rien.

## Utilisateur final

L'occupant d'un foyer ivoirien (ménage, petit commerce). Profil non technique. Peut ne pas
avoir de smartphone (dimension inclusive du thème).

## Parties prenantes

- **Occupant** : veut baisser sa facture sans sacrifier son confort.
- **Réseau / opérateur (CIE)** : bénéficie du lissage des pics (bénéfice indirect, argument pitch).
- **Environnement** : moins de gaz brûlé, moins de CO2 (cœur du thème).
- **Jury du Vibeathon** : évalue impact, faisabilité, IA, innovation, pitch + le pipeline.

## Contraintes

- **Temps** : bootcamp de préparation + 4h de vibe coding le jour J (2026-07-11).
- **Budget matériel** : ~25 000 FCFA pour le prototype (2 prises + charges de démo).
- **Technique** : démo en réseau local fiable, dépendance internet minimale (OpenRouter).
- **Sécurité** : manipulation 220V, modules secteur uniquement, supervision.

## User stories

Priorité : `[MVP]` = requis pour la démo · `[+]` = bonus si le temps le permet.

- **US1 [MVP]** En tant qu'occupant, je veux voir la consommation réelle de chaque appareil
  en temps réel, afin de savoir ce qui coûte cher chez moi.
- **US2 [MVP]** En tant qu'occupant, je veux que le système coupe automatiquement un appareil
  non essentiel en heure de pointe, afin de réduire ma facture et le stress sur le réseau.
- **US3 [MVP]** En tant qu'occupant, je veux comprendre pourquoi l'IA a coupé un appareil,
  afin de garder confiance et contrôle.
- **US4 [MVP]** En tant qu'occupant, je veux définir la priorité de mes appareils (essentiel,
  reportable, confort), afin que l'IA ne coupe jamais ce qui m'est vital.
- **US5 [MVP]** En tant qu'occupant, je veux voir l'impact (kWh, FCFA, CO2 économisés), afin
  de mesurer le bénéfice concret.
- **US6 [+]** En tant qu'occupant, je veux que l'IA décale un usage (couper maintenant,
  rallumer en heures creuses), afin de lisser ma consommation.
- **US7 [+]** En tant qu'occupant sans smartphone, je veux être alerté par SMS ou par la voix,
  afin d'être inclus même sans app.
- **US8 [+]** En tant qu'occupant, je veux fixer un budget mensuel, afin que l'IA délester les
  appareils reportables à l'approche du seuil.

## Critères d'acceptation (mesurables, vérifiables)

Ces critères pilotent aussi la recette (étape 5) et la definition of done (étape 8).

- **CA1 (US1)** : quand un appareil branché sur une prise consomme, sa puissance en watts
  s'affiche sur le dashboard et se met à jour en moins de 2 secondes.
- **CA2 (US2)** : quand l'IA décide de couper un appareil, le relais de sa prise s'ouvre et sa
  consommation mesurée tombe à ~0 W, visible sur le dashboard.
- **CA3 (US3)** : chaque décision de l'IA affiche une explication en langage clair citant au
  moins un facteur (priorité, heure de pointe, budget, ou conso).
- **CA4 (US4)** : un appareil marqué "essentiel" n'est jamais coupé par l'IA, même en heure de
  pointe et même s'il consomme beaucoup.
- **CA5 (US5)** : la page impact affiche kWh, FCFA et CO2 économisés, calculés à partir de la
  conso réellement évitée (pas des valeurs codées en dur).
- **CA6 (US6, bonus)** : une décision de décalage indique une heure de rallumage planifiée.

## Definition of done (rappel étape 8)

Le projet est "done" quand tous les critères CA1 à CA5 sont validés en démo, la CI est verte,
la vidéo de secours est filmée, et la Release v1.0.0 a un README + changelog.
