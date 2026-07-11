# Impact - Chiffres du pitch (chantier Données & impact)

> Objectif : des chiffres crédibles et sourcés pour la page impact de l'app et le pitch.
> ⚠️ Les valeurs ci-dessous sont des PLACEHOLDERS à sourcer et confirmer. Ne pas présenter
> au jury tant qu'elles ne sont pas vérifiées (le jury sanctionne les chiffres survendus).

## Données à rassembler (à sourcer)

| Donnée | Valeur | Source | Statut |
|--------|--------|--------|--------|
| Prix du kWh (tarif CIE domestique) | barème progressif, voir ci-dessous | ANARE-CI / CIE (grille 2024) | 🟡 à valider sur facture |
| Consommation moyenne d'un foyer ivoirien | à confirmer (kWh/mois) | ANARE-CI / stats secteur | 🔴 à sourcer |
| Facteur d'émission CO2 de l'électricité ivoirienne | à confirmer (kg CO2/kWh) | Mix électrique CI (surtout gaz) | 🔴 à sourcer |
| Part du gaz dans le mix électrique | à confirmer (%) | Sources secteur énergie CI | 🔴 à sourcer |
| Nombre de foyers pour la projection ("si 10 000 foyers") | 10 000 (hypothèse pitch) | Choix narratif | 🟡 hypothèse |

## Barème CIE — Tarif Social Domestique 5A (implémenté dans `backend/app/tarif_cie.py`)

Facturation **bimestrielle** (tous les 2 mois). Barème **progressif** (le kWh au-delà du seuil
coûte plus cher), ce qui rend le conseil « reste sous le seuil » honnête et pédagogique.

| Élément | Valeur | Statut |
|---------|--------|--------|
| Prime fixe | 559 FCFA / bimestre | 🟡 à valider |
| Tranche 1 (≤ 80 kWh/bimestre) | 28,84 FCFA/kWh | 🟡 à valider |
| Tranche 2 (> 80 kWh/bimestre) | 59,19 FCFA/kWh | 🟡 à valider |
| Taxes additionnelles (élec. rurale, communale, RTI) | paramètre, défaut 0 | 🔴 à caler sur facture |

Source : anare.ci (le-marche/prix-de-lelectricite), cie.ci (tarifs-electricite). ⚠️ La 1re
tranche est en tarif réduit (souvent hors TVA), la 2e est TTC ; les taxes par kWh sont donc
laissées à 0 par défaut pour ne pas les compter deux fois. **À confirmer avec une vraie facture
CIE** — un seul point à corriger : la structure `TARIF_SOCIAL` dans `tarif_cie.py`.

Repères de calcul (barème actuel) : 100 kWh/mois ≈ 4 985 FCFA (prix moyen ~50, marginal ~59
FCFA/kWh) ; 5 000 FCFA/mois ≈ 100 kWh.

### Tarif Domestique Général 10A (au-delà du social) et bascule automatique

| Élément | Valeur | Statut |
|---------|--------|--------|
| Prime fixe | 1 470,94 FCFA TTC / bimestre | 🟡 à valider |
| Tranche 1 (≈ ≤ 400 kWh/bimestre pour 10A) | 79,01 FCFA/kWh TTC | 🟡 à valider |
| Tranche 2 (au-delà) | 68,48 FCFA/kWh TTC | 🟡 à valider |

**Règle de bascule** (`bareme_pour_conso_mensuelle`) : conso ≤ **100 kWh/mois** → Tarif Social ;
au-delà → Tarif Général (source CIE/ANARE). **Le compteur prépayé (carte) n'a PAS de grille
propre** : c'est la même que le postpayé, **prime fixe incluse** (source CIE). C'est pour ça que
1000 FCFA dure ~9 j pour un petit foyer social mais ~1 j dès qu'on ajoute un climatiseur (bascule
au tarif général).

## Formules de calcul (à implémenter dans backend/impact)

À partir de la consommation évitée mesurée par les prises (conso qui aurait eu lieu si l'IA
n'avait pas coupé/décalé) :

```
kwh_evites      = somme( puissance_coupee_W * duree_h ) / 1000
fcfa_economises = kwh_evites * prix_kwh_fcfa
co2_evite_kg    = kwh_evites * facteur_co2_kg_par_kwh
```

Projection pitch :
```
impact_national = impact_foyer * nombre_foyers   // ex: * 10 000
```

## Note méthodo

Le calcul doit partir de la **conso réellement évitée** (mesurée), pas de valeurs codées en
dur (critère d'acceptation CA5). Les constantes (prix kWh, facteur CO2) sont des paramètres
sourcés, séparés du code, pour rester honnêtes et ajustables.
