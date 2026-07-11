"""Barème tarifaire CIE (Côte d'Ivoire) — conversion kWh ⇄ FCFA.

Ce module transforme une consommation (kWh) en montant de facture (FCFA) et
inversement, en appliquant le **vrai barème progressif par tranches** de la CIE,
et non un prix unique par kWh.

Choix du projet (ADR-009) : on modélise le **Tarif Social Domestique (5A / 1,1 kVA)**,
qui cible les foyers modestes (thème « inclusif » du Vibeathon) et qui est le seul
tarif vraiment **progressif** (le kWh coûte plus cher au-delà d'un seuil).

⚠️ FACTURATION BIMESTRIELLE : la CIE facture tous les 2 mois. Les seuils de tranches
sont donc exprimés **par bimestre**. Les helpers mensuels (`cout_mensuel`,
`kwh_pour_budget_mensuel`) raisonnent en « moitié de bimestre ».

⚠️ CHIFFRES À VALIDER : les montants ci-dessous viennent d'ANARE-CI / CIE (grille
janvier 2024) mais doivent être confirmés avec une **vraie facture CIE**. Ils sont
volontairement regroupés dans une seule structure de données (`TARIF_SOCIAL`) pour
qu'une correction soit triviale et ne touche pas la logique de calcul.

Sources : anare.ci (le-marche/prix-de-lelectricite) et cie.ci (tarifs-electricite).

Fonctions pures et testables (même esprit que impact.py / prediction.py).
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Tranche:
    """Une tranche de facturation : jusqu'à `plafond_kwh` (par bimestre), au prix
    `prix_fcfa_kwh`. `plafond_kwh = None` => tranche finale (pas de plafond)."""
    plafond_kwh: float | None
    prix_fcfa_kwh: float


@dataclass(frozen=True)
class Bareme:
    """Un barème CIE complet (structure de données = source de vérité, ADR-009)."""
    nom: str
    puissance_va: int                    # puissance souscrite (VA), ex. 1100 pour 5A
    prime_fixe_bimestre_fcfa: float      # abonnement fixe, facturé même à 0 kWh
    tranches: tuple[Tranche, ...]        # dans l'ordre croissant de consommation
    taxes_par_kwh_fcfa: float = 0.0      # petites taxes (élec. rurale, communale, RTI…)
    #                                      laissé à 0 par défaut pour ne pas doubler la
    #                                      TVA déjà incluse dans les prix ci-dessous ;
    #                                      à ajuster sur facture réelle.


# --------------------------------------------------------------------------- #
#  Barème retenu : Tarif Social Domestique 5A (à valider sur facture)         #
# --------------------------------------------------------------------------- #
# Grille ANARE/CIE 2024 :
#   - Prime fixe : 559 FCFA / bimestre
#   - Tranche 1 : jusqu'à 80 kWh/bimestre  -> 28,84 FCFA/kWh (tarif social réduit)
#   - Tranche 2 : au-delà de 80 kWh        -> 59,19 FCFA/kWh (TTC)
# NB : progressif => le kWh « de trop » (tranche 2) coûte 2x plus cher. C'est le
# levier pédagogique de l'app : rester sous 80 kWh/bimestre garde le kWh à ~29 FCFA.
TARIF_SOCIAL = Bareme(
    nom="Tarif Social Domestique 5A",
    puissance_va=1100,
    prime_fixe_bimestre_fcfa=559.0,
    tranches=(
        Tranche(plafond_kwh=80.0, prix_fcfa_kwh=28.84),
        Tranche(plafond_kwh=None, prix_fcfa_kwh=59.19),
    ),
    taxes_par_kwh_fcfa=0.0,
)

# --------------------------------------------------------------------------- #
#  Tarif Domestique Général (10A et +) — au-delà du tarif social               #
# --------------------------------------------------------------------------- #
# Grille ANARE/CIE 2024 (TTC) : prime fixe 1470,94 FCFA/bimestre ; 1re tranche 79,01 FCFA/kWh ;
# 2e tranche 68,48 FCFA/kWh (dégressif). Seuil de 1re tranche = 180 kWh/kVA/bimestre ; on
# l'approxime à 400 kWh/bimestre pour 10A (~2,2 kVA), à valider sur facture.
TARIF_GENERAL = Bareme(
    nom="Tarif Domestique Général 10A",
    puissance_va=2200,
    prime_fixe_bimestre_fcfa=1470.94,
    tranches=(
        Tranche(plafond_kwh=400.0, prix_fcfa_kwh=79.01),
        Tranche(plafond_kwh=None, prix_fcfa_kwh=68.48),
    ),
    taxes_par_kwh_fcfa=0.0,
)

# Barème par défaut de l'application.
BAREME_DEFAUT = TARIF_SOCIAL

# Seuil d'éligibilité au tarif social : conso moyenne ≤ 100 kWh/mois (source CIE/ANARE).
# Au-delà, le client bascule au Tarif Domestique Général (même en prépayé).
SEUIL_SOCIAL_KWH_MOIS = 100.0


def bareme_pour_conso_mensuelle(kwh_mois: float) -> Bareme:
    """Choisit le barème réellement applicable selon la consommation mensuelle estimée.

    ≤ 100 kWh/mois => Tarif Social ; au-delà => Tarif Domestique Général. Le mode prépayé
    (compteur à carte) n'a PAS de grille propre : c'est la même que le postpayé (source CIE).
    """
    return TARIF_SOCIAL if kwh_mois <= SEUIL_SOCIAL_KWH_MOIS else TARIF_GENERAL


@dataclass
class LigneTranche:
    """Détail d'une tranche dans une facture (pour l'explication à l'utilisateur)."""
    kwh: float
    prix_fcfa_kwh: float
    montant_fcfa: float


@dataclass
class Facture:
    """Décomposition complète d'une facture bimestrielle."""
    kwh: float
    prime_fixe_fcfa: float
    cout_energie_fcfa: float
    taxes_fcfa: float
    total_fcfa: float
    prix_moyen_fcfa_kwh: float           # total / kwh (0 si kwh == 0)
    lignes: list[LigneTranche] = field(default_factory=list)


# --------------------------------------------------------------------------- #
#  1. Facture bimestrielle : kWh -> FCFA (le cœur du barème)                   #
# --------------------------------------------------------------------------- #

def facture_bimestre(kwh: float, bareme: Bareme = BAREME_DEFAUT) -> Facture:
    """Calcule la facture d'un bimestre pour une consommation `kwh` (par bimestre)."""
    if kwh < 0:
        raise ValueError("kwh doit être positif")

    lignes: list[LigneTranche] = []
    reste = kwh
    plancher = 0.0
    cout_energie = 0.0
    for tr in bareme.tranches:
        if reste <= 0:
            break
        largeur = float("inf") if tr.plafond_kwh is None else max(0.0, tr.plafond_kwh - plancher)
        kwh_tranche = min(reste, largeur)
        montant = kwh_tranche * tr.prix_fcfa_kwh
        lignes.append(LigneTranche(
            kwh=round(kwh_tranche, 4),
            prix_fcfa_kwh=tr.prix_fcfa_kwh,
            montant_fcfa=round(montant, 2),
        ))
        cout_energie += montant
        reste -= kwh_tranche
        plancher = tr.plafond_kwh if tr.plafond_kwh is not None else plancher

    taxes = kwh * bareme.taxes_par_kwh_fcfa
    total = bareme.prime_fixe_bimestre_fcfa + cout_energie + taxes
    return Facture(
        kwh=round(kwh, 4),
        prime_fixe_fcfa=round(bareme.prime_fixe_bimestre_fcfa, 2),
        cout_energie_fcfa=round(cout_energie, 2),
        taxes_fcfa=round(taxes, 2),
        total_fcfa=round(total, 2),
        prix_moyen_fcfa_kwh=round(total / kwh, 2) if kwh > 0 else 0.0,
        lignes=lignes,
    )


def cout_bimestre(kwh: float, bareme: Bareme = BAREME_DEFAUT) -> float:
    """Raccourci : total FCFA d'un bimestre pour `kwh` kWh."""
    return facture_bimestre(kwh, bareme).total_fcfa


# --------------------------------------------------------------------------- #
#  2. Vue mensuelle (moitié de bimestre) — pour l'app qui pense en mois        #
# --------------------------------------------------------------------------- #
# Hypothèse : consommation régulière sur les 2 mois. On calcule le bimestre
# équivalent (kwh_mois * 2) puis on ramène à un mois (/ 2). Cela répartit
# correctement la prime fixe et applique le seuil de tranche bimestriel.

def cout_mensuel(kwh_mois: float, bareme: Bareme = BAREME_DEFAUT) -> float:
    """Coût FCFA d'un mois pour `kwh_mois` kWh (approx. régulière sur le bimestre)."""
    return round(cout_bimestre(kwh_mois * 2.0, bareme) / 2.0, 2)


def facture_mensuelle(kwh_mois: float, bareme: Bareme = BAREME_DEFAUT) -> Facture:
    """Facture ramenée au mois (tous les montants divisés par 2 vs le bimestre)."""
    f = facture_bimestre(kwh_mois * 2.0, bareme)
    return Facture(
        kwh=round(kwh_mois, 4),
        prime_fixe_fcfa=round(f.prime_fixe_fcfa / 2.0, 2),
        cout_energie_fcfa=round(f.cout_energie_fcfa / 2.0, 2),
        taxes_fcfa=round(f.taxes_fcfa / 2.0, 2),
        total_fcfa=round(f.total_fcfa / 2.0, 2),
        prix_moyen_fcfa_kwh=f.prix_moyen_fcfa_kwh,
        lignes=[LigneTranche(round(ln.kwh / 2.0, 4), ln.prix_fcfa_kwh, round(ln.montant_fcfa / 2.0, 2))
                for ln in f.lignes],
    )


# --------------------------------------------------------------------------- #
#  3. Conversion inverse : FCFA -> kWh (barème non-linéaire, on inverse tranche par tranche)
# --------------------------------------------------------------------------- #

def kwh_pour_budget_bimestre(budget_fcfa: float, bareme: Bareme = BAREME_DEFAUT) -> float:
    """Combien de kWh (par bimestre) on peut consommer pour un budget donné."""
    if budget_fcfa < 0:
        raise ValueError("budget_fcfa doit être positif")
    dispo = budget_fcfa - bareme.prime_fixe_bimestre_fcfa
    if dispo <= 0:
        return 0.0  # le budget ne couvre même pas l'abonnement fixe

    kwh = 0.0
    plancher = 0.0
    for tr in bareme.tranches:
        prix_effectif = tr.prix_fcfa_kwh + bareme.taxes_par_kwh_fcfa
        largeur = float("inf") if tr.plafond_kwh is None else max(0.0, tr.plafond_kwh - plancher)
        cout_tranche_pleine = largeur * prix_effectif
        if dispo >= cout_tranche_pleine and largeur != float("inf"):
            kwh += largeur
            dispo -= cout_tranche_pleine
            plancher = tr.plafond_kwh
        else:
            kwh += dispo / prix_effectif if prix_effectif > 0 else 0.0
            dispo = 0.0
            break
    return round(kwh, 3)


def kwh_pour_budget_mensuel(budget_mois_fcfa: float, bareme: Bareme = BAREME_DEFAUT) -> float:
    """Combien de kWh par mois pour un budget mensuel (via le bimestre équivalent)."""
    return round(kwh_pour_budget_bimestre(budget_mois_fcfa * 2.0, bareme) / 2.0, 3)


def kwh_pour_budget_mensuel_auto(budget_mois_fcfa: float) -> tuple[float, Bareme]:
    """kWh/mois pour un budget, en choisissant le barème RÉELLEMENT applicable.

    Un gros budget (ex. 20 000 FCFA/mois) dépasse le seuil du tarif social : à ce niveau
    le foyer est facturé au Tarif Domestique Général. On estime d'abord au social ; si la
    conso dépasse le seuil social, on recalcule au général. Renvoie (kWh, barème utilisé).
    """
    kwh_social = kwh_pour_budget_mensuel(budget_mois_fcfa, TARIF_SOCIAL)
    if kwh_social <= SEUIL_SOCIAL_KWH_MOIS:
        return kwh_social, TARIF_SOCIAL
    # Conso élevée : on ne bascule au Général (plus cher) que si, MÊME à ce tarif, la conso
    # dépasse encore le seuil social — signe d'un vrai gros consommateur. Sinon (petit budget
    # juste au-dessus du seuil), on garde le tarif social pour ne pas surestimer la facture.
    kwh_general = kwh_pour_budget_mensuel(budget_mois_fcfa, TARIF_GENERAL)
    if kwh_general > SEUIL_SOCIAL_KWH_MOIS:
        return kwh_general, TARIF_GENERAL
    return kwh_social, TARIF_SOCIAL


# --------------------------------------------------------------------------- #
#  4. Prix marginal / moyen — utile pour chiffrer une économie honnêtement     #
# --------------------------------------------------------------------------- #

def prix_marginal_bimestre(kwh_bimestre: float, bareme: Bareme = BAREME_DEFAUT) -> float:
    """Prix (FCFA) du prochain kWh à ce niveau de consommation bimestrielle.

    C'est le vrai prix « à la marge » : couper 1 kWh quand on est en tranche 2
    fait économiser ~59 FCFA, pas le prix moyen. Indispensable pour ne pas mentir
    sur l'économie annoncée.
    """
    for tr in bareme.tranches:
        if tr.plafond_kwh is None or kwh_bimestre < tr.plafond_kwh:
            return round(tr.prix_fcfa_kwh + bareme.taxes_par_kwh_fcfa, 2)
    return round(bareme.tranches[-1].prix_fcfa_kwh + bareme.taxes_par_kwh_fcfa, 2)


def prix_marginal_mensuel(kwh_mois: float, bareme: Bareme = BAREME_DEFAUT) -> float:
    """Prix du prochain kWh à ce niveau de conso mensuelle (via le bimestre équivalent)."""
    return prix_marginal_bimestre(kwh_mois * 2.0, bareme)
