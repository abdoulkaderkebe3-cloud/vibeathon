"""Estimation & prédiction de consommation (EcoWatt).

Porte la logique de prévision et de recommandation :
  - normalisation : l'utilisateur fournit ses relevés en **kWh** OU en **FCFA** (le montant est
    converti via le **barème progressif CIE**, pas un prix unique) ;
  - prévision : tendance + **saisonnalité hebdomadaire** (lissage de Holt-Winters, période 7 j),
    avec repli sur Holt/régression quand l'historique est court ;
  - fiabilité : backtest MAPE sur les derniers jours ;
  - recommandation : objectif de consommation + actions concrètes chiffrées (FCFA, CO2) ;
  - comparaison : évolution vs le mois précédent (hausse/baisse, surcoût, message honnête).

Tous les montants FCFA passent par `tarif_cie` (barème social CIE, ADR-009) : le prix du kWh
n'est plus constant, il dépend de la tranche de consommation.

Fonctions pures et testables (même esprit que impact.py). Miroir Python de PredictionEnergie.java.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

from . import tarif_cie
from .config import settings

PERIODE_SAISON = 7  # rythme hebdomadaire
OBJECTIF_REDUCTION = 0.15  # -15 % par défaut si aucun budget n'est fixé
JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]


class Unite(str, Enum):
    kwh = "kwh"
    fcfa = "fcfa"


@dataclass
class Prevision:
    kwh_jour_prevu: float
    prochains_jours_kwh: list[float]
    index_premier_jour: int  # index absolu du 1er jour prévu (=> jour de la semaine)
    kwh_semaine_prevu: float
    cout_semaine_fcfa: float
    pente_kwh_jour: float
    fiabilite_pct: float | None


@dataclass
class ActionReco:
    titre: str
    kwh_par_jour: float
    fcfa_par_mois: float
    comment_faire: str


@dataclass
class Recommandation:
    prevision: Prevision
    objectif_kwh_jour: float
    cout_mois_prevu_fcfa: float
    cout_mois_objectif_fcfa: float
    economie_mois_fcfa: float
    co2_mois_evite_kg: float
    sur_la_bonne_voie: bool
    jour_le_plus_charge: str
    actions: list[ActionReco] = field(default_factory=list)


# --------------------------------------------------------------------------- #
#  Constantes métier (lues dans la config du projet)                          #
# --------------------------------------------------------------------------- #

def _co2_par_kwh() -> float:
    return settings.ecowatt_co2_kg_par_kwh


# --------------------------------------------------------------------------- #
#  1. Normalisation : tout en kWh                                             #
# --------------------------------------------------------------------------- #

def en_kwh(valeurs: list[float], unite: Unite) -> list[float]:
    """Convertit les relevés en kWh. Si saisis en FCFA, on inverse le barème CIE.

    Approximation assumée : un relevé FCFA journalier est converti via le prix moyen
    du kWh au niveau de consommation mensuel impliqué (le barème est bimestriel, donc
    un kWh isolé n'a pas de « prix » unique). Suffisant pour alimenter la prévision ;
    les montants finaux, eux, sont recalculés exactement par le barème.
    """
    if unite == Unite.kwh:
        return [max(0.0, v) for v in valeurs]

    # FCFA -> kWh : on estime d'abord la conso mensuelle totale via l'inverse du barème,
    # puis on répartit chaque valeur au prorata (prix moyen effectif du foyer).
    valeurs = [max(0.0, v) for v in valeurs]
    total_fcfa = sum(valeurs)
    if total_fcfa <= 0:
        return [0.0 for _ in valeurs]
    # On suppose la série ≈ 1 mois de relevés (la prime fixe est mensualisée dedans).
    kwh_mois = tarif_cie.kwh_pour_budget_mensuel(total_fcfa)
    prix_moyen = total_fcfa / kwh_mois if kwh_mois > 0 else tarif_cie.prix_marginal_mensuel(0.0)
    return [v / prix_moyen for v in valeurs]


# --------------------------------------------------------------------------- #
#  2. Moyenne mobile                                                          #
# --------------------------------------------------------------------------- #

def moyenne_mobile(serie: list[float], fenetre: int) -> float:
    n = len(serie)
    if n == 0:
        return 0.0
    debut = max(0, n - fenetre)
    return sum(serie[debut:]) / (n - debut)


# --------------------------------------------------------------------------- #
#  3. Régression linéaire par moindres carrés (la tendance)                   #
# --------------------------------------------------------------------------- #

def regression_lineaire(serie: list[float]) -> tuple[float, float]:
    """Ajuste y = a + b*x sur (x = index du jour, y = kWh). Renvoie (a, b)."""
    n = len(serie)
    if n < 2:
        return (serie[0] if n == 1 else 0.0, 0.0)

    moy_x = (n - 1) / 2.0
    moy_y = moyenne_mobile(serie, n)
    num = den = 0.0
    for i, y in enumerate(serie):
        dx = i - moy_x
        num += dx * (y - moy_y)
        den += dx * dx
    b = num / den if den else 0.0
    a = moy_y - b * moy_x
    return a, b


# --------------------------------------------------------------------------- #
#  4. Lissage exponentiel de Holt (niveau + tendance)                         #
# --------------------------------------------------------------------------- #

def holt(serie: list[float], alpha: float, beta: float) -> tuple[float, float]:
    n = len(serie)
    if n == 0:
        return 0.0, 0.0
    if n == 1:
        return serie[0], 0.0
    niveau = serie[0]
    tendance = serie[1] - serie[0]
    for t in range(1, n):
        niveau_prec = niveau
        niveau = alpha * serie[t] + (1 - alpha) * (niveau + tendance)
        tendance = beta * (niveau - niveau_prec) + (1 - beta) * tendance
    return niveau, tendance


# --------------------------------------------------------------------------- #
#  5. Holt-Winters (niveau + tendance + SAISONNALITÉ hebdomadaire)            #
# --------------------------------------------------------------------------- #

def holt_winters_fit(
    y: list[float], m: int, alpha: float, beta: float, gamma: float
) -> tuple[float, float, list[float]]:
    """Triple lissage additif, période m. Renvoie (niveau, tendance, saisonniers[0..m-1])."""
    n = len(y)
    niveau = sum(y[:m]) / m
    tendance = 0.0
    if n >= 2 * m:
        s1 = sum(y[:m])
        s2 = sum(y[m : 2 * m])
        tendance = (s2 - s1) / (m * m)
    S = [y[i] - niveau for i in range(m)]  # coefficients saisonniers initiaux
    for t in range(m, n):
        si = t % m
        niveau_prec = niveau
        niveau = alpha * (y[t] - S[si]) + (1 - alpha) * (niveau + tendance)
        tendance = beta * (niveau - niveau_prec) + (1 - beta) * tendance
        S[si] = gamma * (y[t] - niveau) + (1 - gamma) * S[si]
    return niveau, tendance, S


# --------------------------------------------------------------------------- #
#  6. Prévision                                                               #
# --------------------------------------------------------------------------- #

def prevoir(serie: list[float], h: int) -> float:
    """Prévoit la consommation à h jours (h=1 => demain)."""
    n = len(serie)
    if n == 0:
        return 0.0
    if n == 1:
        return serie[0]

    # Assez de recul : Holt-Winters (saisonnalité hebdo).
    if n >= 2 * PERIODE_SAISON:
        niveau, tendance, S = holt_winters_fit(serie, PERIODE_SAISON, 0.4, 0.1, 0.3)
        si = (n - 1 + h) % PERIODE_SAISON
        return max(0.0, niveau + h * tendance + S[si])

    # Repli : régression (+ Holt si >= 4 points).
    a, b = regression_lineaire(serie)
    val_reg = a + b * (n - 1 + h)
    if n < 4:
        return max(0.0, val_reg)
    niveau, tendance = holt(serie, 0.5, 0.3)
    val_holt = niveau + h * tendance
    return max(0.0, 0.6 * val_holt + 0.4 * val_reg)


def mape_pct(serie: list[float]) -> float | None:
    """Erreur moyenne en % (MAPE) sur les 7 derniers jours, en prédisant depuis le passé seul."""
    n = len(serie)
    debut = max(2, n - 7)
    if n <= debut:
        return None
    somme = 0.0
    compte = 0
    for t in range(debut, n):
        pred = prevoir(serie[:t], 1)
        if serie[t] > 0:
            somme += abs(pred - serie[t]) / serie[t]
            compte += 1
    return None if compte == 0 else 100.0 * somme / compte


def predire(serie: list[float]) -> Prevision:
    """Prévision jour/semaine + fiabilité à partir d'une série de kWh journaliers."""
    n = len(serie)
    prochains = [prevoir(serie, h) for h in range(1, 8)]
    kwh_semaine = sum(prochains)
    _, pente = regression_lineaire(serie)
    mape = mape_pct(serie)
    fiabilite = None if mape is None else max(0.0, min(100.0, 100.0 - mape))
    # Coût de la semaine via le barème : conso semaine ≈ 7/30 de mois.
    cout_semaine = tarif_cie.cout_mensuel(kwh_semaine * 30.0 / 7.0) * 7.0 / 30.0
    return Prevision(
        kwh_jour_prevu=round(prochains[0], 3),
        prochains_jours_kwh=[round(v, 3) for v in prochains],
        index_premier_jour=n,
        kwh_semaine_prevu=round(kwh_semaine, 3),
        cout_semaine_fcfa=round(cout_semaine, 2),
        pente_kwh_jour=round(pente, 4),
        fiabilite_pct=None if fiabilite is None else round(fiabilite, 1),
    )


# --------------------------------------------------------------------------- #
#  7. Recommandation                                                          #
# --------------------------------------------------------------------------- #

def catalogue_leviers(prix_kwh: float) -> list[ActionReco]:
    """Leviers d'économie, du plus simple au plus contraignant (foyer type).

    `prix_kwh` = prix **marginal** du kWh au niveau de conso du foyer (le vrai prix
    d'un kWh évité), pour ne pas surestimer l'économie affichée.
    """
    prix = prix_kwh
    data = [
        ("Éliminer les veilles", 0.30,
         "Branche TV, box et chargeurs sur une multiprise à interrupteur et coupe-la la nuit."),
        ("Réduire la télévision de 2 h/jour", 0.16,
         "Programme une minuterie et évite la TV allumée 'en fond' quand personne ne regarde."),
        ("Minuterie sur le ventilateur", 0.20,
         "Coupe le ventilateur automatiquement après l'endormissement (2 à 3 h)."),
        ("Passer aux ampoules LED", 0.10,
         "Remplace les ampoules restantes par des LED : même lumière, ~8x moins de watts."),
    ]
    return [
        ActionReco(titre=t, kwh_par_jour=k, fcfa_par_mois=round(k * 30 * prix, 2), comment_faire=c)
        for (t, k, c) in data
    ]


def _jour_le_plus_charge(prev: Prevision) -> str:
    idx_max = max(range(len(prev.prochains_jours_kwh)), key=lambda j: prev.prochains_jours_kwh[j])
    return JOURS[(prev.index_premier_jour + idx_max) % 7]


def recommander(
    valeurs: list[float], unite: Unite, budget_mensuel_fcfa: float | None = None
) -> Recommandation:
    """Produit une prévision + un plan d'action à partir des relevés utilisateur."""
    serie = en_kwh(valeurs, unite)
    prev = predire(serie)
    co2 = _co2_par_kwh()
    kwh_jour = prev.kwh_jour_prevu
    kwh_mois = kwh_jour * 30.0

    # "Ce qu'il devrait consommer" : dérivé du budget (via l'inverse du barème), sinon -15 %.
    if budget_mensuel_fcfa is not None:
        objectif = tarif_cie.kwh_pour_budget_mensuel(budget_mensuel_fcfa) / 30.0
    else:
        objectif = kwh_jour * (1 - OBJECTIF_REDUCTION)

    cout_prevu = tarif_cie.cout_mensuel(kwh_mois)
    cout_objectif = tarif_cie.cout_mensuel(objectif * 30.0)
    sur_la_bonne_voie = kwh_jour <= objectif
    manque = max(0.0, kwh_jour - objectif)

    # Prix marginal = ce que coûte réellement le prochain kWh au niveau de conso actuel.
    prix_marg = tarif_cie.prix_marginal_mensuel(kwh_mois)

    actions: list[ActionReco] = []
    cumul = 0.0
    for levier in catalogue_leviers(prix_marg):
        if cumul >= manque:
            break
        actions.append(levier)
        cumul += levier.kwh_par_jour

    # Économie chiffrée honnêtement : différence de facture réelle entre avant et après.
    reduction = min(cumul, manque)
    economie = tarif_cie.cout_mensuel(kwh_mois) - tarif_cie.cout_mensuel(max(0.0, kwh_mois - reduction * 30.0))
    return Recommandation(
        prevision=prev,
        objectif_kwh_jour=round(objectif, 3),
        cout_mois_prevu_fcfa=round(cout_prevu, 2),
        cout_mois_objectif_fcfa=round(cout_objectif, 2),
        economie_mois_fcfa=round(economie, 2),
        co2_mois_evite_kg=round(reduction * 30 * co2, 3),
        sur_la_bonne_voie=sur_la_bonne_voie,
        jour_le_plus_charge=_jour_le_plus_charge(prev),
        actions=actions,
    )


# --------------------------------------------------------------------------- #
#  8. Comparaison vs mois précédent                                           #
# --------------------------------------------------------------------------- #

@dataclass
class Comparaison:
    kwh_courant: float
    kwh_precedent: float
    cout_courant_fcfa: float
    cout_precedent_fcfa: float
    variation_kwh: float           # + = hausse, - = baisse
    variation_fcfa: float          # + = surcoût, - = économie
    variation_pct: float | None    # None si mois précédent = 0
    en_hausse: bool
    message: str


def comparer_mois(
    valeur_courante: float,
    valeur_precedente: float,
    unite: Unite = Unite.kwh,
) -> Comparaison:
    """Compare la conso/le coût du mois courant à celui du mois précédent.

    Les deux valeurs sont dans la même `unite` (kWh ou FCFA). En FCFA, on remonte
    d'abord aux kWh via l'inverse du barème pour raisonner sur la vraie consommation.
    """
    if unite == Unite.fcfa:
        kwh_courant = tarif_cie.kwh_pour_budget_mensuel(max(0.0, valeur_courante))
        kwh_precedent = tarif_cie.kwh_pour_budget_mensuel(max(0.0, valeur_precedente))
    else:
        kwh_courant = max(0.0, valeur_courante)
        kwh_precedent = max(0.0, valeur_precedente)

    cout_courant = tarif_cie.cout_mensuel(kwh_courant)
    cout_precedent = tarif_cie.cout_mensuel(kwh_precedent)
    var_kwh = kwh_courant - kwh_precedent
    var_fcfa = cout_courant - cout_precedent
    var_pct = (100.0 * var_kwh / kwh_precedent) if kwh_precedent > 0 else None
    en_hausse = var_kwh > 0

    if abs(var_kwh) < 1e-6:
        msg = "Consommation stable par rapport au mois dernier."
    elif en_hausse:
        pct = f" (+{var_pct:.0f} %)" if var_pct is not None else ""
        msg = (f"Consommation en hausse{pct} : +{var_kwh:.1f} kWh, soit environ "
               f"+{var_fcfa:.0f} FCFA sur ta facture. Regarde ce qui a changé (climatiseur, "
               f"appareils laissés allumés) et décale les usages hors des heures de pointe.")
    else:
        pct = f" ({var_pct:.0f} %)" if var_pct is not None else ""
        msg = (f"Bravo, consommation en baisse{pct} : {var_kwh:.1f} kWh, soit environ "
               f"{var_fcfa:.0f} FCFA économisés vs le mois dernier. Continue comme ça.")

    return Comparaison(
        kwh_courant=round(kwh_courant, 3),
        kwh_precedent=round(kwh_precedent, 3),
        cout_courant_fcfa=round(cout_courant, 2),
        cout_precedent_fcfa=round(cout_precedent, 2),
        variation_kwh=round(var_kwh, 3),
        variation_fcfa=round(var_fcfa, 2),
        variation_pct=None if var_pct is None else round(var_pct, 1),
        en_hausse=en_hausse,
        message=msg,
    )


# --------------------------------------------------------------------------- #
#  9. Compteur à carte / prépayé : prédire la durée d'une recharge            #
# --------------------------------------------------------------------------- #
# Puissances moyennes indicatives (W) des appareils courants en Côte d'Ivoire.
# Ce sont des ESTIMATIONS (la vraie prise EcoWatt mesurerait le réel).
PUISSANCES_W: dict[str, float] = {
    "ampoule led": 10, "ampoule": 60, "ventilateur": 60, "television": 100,
    "decodeur": 15, "climatiseur": 900, "fer a repasser": 1000, "bouilloire": 1500,
    "chargeur": 5, "ordinateur": 50, "machine a laver": 500, "pompe a eau": 750,
    "refrigerateur": 0.0, "congelateur": 0.0,  # cycliques : voir KWH_JOUR_CYCLIQUE
}
# Appareils cycliques (compresseur) : on raisonne en kWh/jour, pas en heures d'usage.
KWH_JOUR_CYCLIQUE: dict[str, float] = {"refrigerateur": 1.3, "congelateur": 2.0}

# Libellés d'affichage (singulier, pluriel) — accentués, pour des réponses propres en démo.
LIBELLES: dict[str, tuple[str, str]] = {
    "ampoule led": ("ampoule LED", "ampoules LED"),
    "ampoule": ("ampoule", "ampoules"),
    "ventilateur": ("ventilateur", "ventilateurs"),
    "television": ("télévision", "télévisions"),
    "decodeur": ("décodeur", "décodeurs"),
    "climatiseur": ("climatiseur", "climatiseurs"),
    "fer a repasser": ("fer à repasser", "fers à repasser"),
    "bouilloire": ("bouilloire", "bouilloires"),
    "chargeur": ("chargeur", "chargeurs"),
    "ordinateur": ("ordinateur", "ordinateurs"),
    "machine a laver": ("machine à laver", "machines à laver"),
    "pompe a eau": ("pompe à eau", "pompes à eau"),
    "refrigerateur": ("réfrigérateur", "réfrigérateurs"),
    "congelateur": ("congélateur", "congélateurs"),
}


def _libelle(nom: str, quantite: int = 1) -> str:
    sing, plur = LIBELLES.get(nom, (nom, nom))
    return plur if quantite > 1 else sing

# Synonymes/diminutifs (texte normalisé sans accent) -> nom canonique. « led » avant « ampoule ».
ALIAS: dict[str, list[str]] = {
    "ampoule led": ["ampoule led", "ampoules led", "lampe led", "led"],
    "ampoule": ["ampoule", "ampoules", "lampe", "lampes", "lumiere"],
    "ventilateur": ["ventilateur", "ventilo", "ventil"],
    "television": ["television", "televiseur", "tele", "tv", "ecran"],
    "decodeur": ["decodeur", "canal", "tnt"],
    "climatiseur": ["climatiseur", "climatisation", "clim", "split"],
    "fer a repasser": ["fer a repasser", "fer", "repasser"],
    "bouilloire": ["bouilloire", "theiere"],
    "chargeur": ["chargeur"],
    "ordinateur": ["ordinateur", "ordi", "pc", "laptop"],
    "machine a laver": ["machine a laver", "lave linge", "lave-linge", "machine"],
    "pompe a eau": ["pompe a eau", "pompe"],
    "refrigerateur": ["refrigerateur", "frigo", "frigidaire", "refregirateur", "refrigerateurs"],
    "congelateur": ["congelateur", "congel", "congelo"],
}


@dataclass
class AppareilConso:
    nom: str
    quantite: int
    puissance_w: float          # 0 pour un cyclique (on utilise kwh_jour direct)
    heures: float               # heures/jour (ignoré pour un cyclique)
    kwh_jour: float             # conso journalière totale (quantité incluse)


@dataclass
class ConseilPrepaye:
    texte: str
    jours_gagnes: float


@dataclass
class PredictionPrepaye:
    appareils: list[AppareilConso]
    kwh_jour: float
    fcfa_jour: float
    montant_fcfa: float | None
    jours: float | None
    prix_moyen_kwh: float
    conseils: list[ConseilPrepaye] = field(default_factory=list)
    message: str = ""


def _kwh_jour(nom: str, heures: float, quantite: int) -> float:
    if nom in KWH_JOUR_CYCLIQUE:
        return KWH_JOUR_CYCLIQUE[nom] * quantite
    return PUISSANCES_W.get(nom, 0.0) * heures * quantite / 1000.0


def _fcfa_jour(kwh_jour: float) -> float:
    """Coût journalier réel : le prépayé paie la même grille que le postpayé, PRIME FIXE
    INCLUSE (source CIE). Le barème (social ≤100 kWh/mois, sinon général) est choisi selon
    la consommation mensuelle estimée."""
    kwh_mois = kwh_jour * 30.0
    bareme = tarif_cie.bareme_pour_conso_mensuelle(kwh_mois)
    return tarif_cie.cout_mensuel(kwh_mois, bareme) / 30.0


def _fmt(n: float, d: int = 0) -> str:
    return f"{n:,.{d}f}".replace(",", " ").replace(".", ",")


def predire_prepaye(
    appareils: list[tuple[str, float, int]],
    montant_fcfa: float | None = None,
) -> PredictionPrepaye:
    """Prédit la durée d'une recharge prépayée à partir des appareils et heures d'usage.

    `appareils` : liste de (nom_canonique, heures_par_jour, quantite). Les cycliques
    (frigo, congélateur) ignorent les heures. Calcul déterministe et exact.
    """
    lignes: list[AppareilConso] = []
    for nom, heures, quantite in appareils:
        q = max(1, int(quantite))
        kwhj = _kwh_jour(nom, heures, q)
        lignes.append(AppareilConso(
            nom=nom, quantite=q,
            puissance_w=PUISSANCES_W.get(nom, 0.0),
            heures=heures, kwh_jour=round(kwhj, 3),
        ))

    kwh_jour = sum(ligne.kwh_jour for ligne in lignes)
    fcfa_jour = _fcfa_jour(kwh_jour)
    jours = (montant_fcfa / fcfa_jour) if (montant_fcfa and fcfa_jour > 0) else None
    prix_moyen = (fcfa_jour / kwh_jour) if kwh_jour > 0 else 0.0

    # Conseils chiffrés (exacts) : réduire les 2 plus gros postes NON cycliques de 2 h/jour.
    conseils: list[ConseilPrepaye] = []
    if montant_fcfa and fcfa_jour > 0:
        modulables = sorted(
            [ln for ln in lignes if ln.nom not in KWH_JOUR_CYCLIQUE and ln.heures >= 2],
            key=lambda ln: ln.kwh_jour, reverse=True,
        )
        for ligne in modulables[:2]:
            gain_kwh = ligne.puissance_w * 2 * ligne.quantite / 1000.0
            fcfa_jour_apres = _fcfa_jour(max(0.0, kwh_jour - gain_kwh))
            jours_apres = montant_fcfa / fcfa_jour_apres if fcfa_jour_apres > 0 else jours
            gagnes = (jours_apres - jours) if (jours_apres and jours) else 0.0
            if gagnes >= 0.3:
                conseils.append(ConseilPrepaye(
                    texte=f"2 h de {_libelle(ligne.nom)} en moins par jour",
                    jours_gagnes=round(gagnes, 1),
                ))

    # Message détaillé (montre le calcul, argument jury).
    detail = ", ".join(
        (f"{ligne.quantite} " if ligne.quantite > 1 else "")
        + _libelle(ligne.nom, ligne.quantite)
        + (" en continu" if ligne.nom in KWH_JOUR_CYCLIQUE else f" {_fmt(ligne.heures)} h")
        + f" → {_fmt(ligne.kwh_jour, 2)} kWh/j"
        for ligne in lignes
    )
    tarif_nom = tarif_cie.bareme_pour_conso_mensuelle(kwh_jour * 30.0).nom
    msg = (f"D'après tes appareils ({detail}), tu consommes environ "
           f"{_fmt(kwh_jour, 2)} kWh par jour, soit à peu près {_fmt(fcfa_jour)} FCFA/jour "
           f"({tarif_nom}, prime fixe incluse).")
    if jours is not None:
        msg += f" Ta recharge de {_fmt(montant_fcfa)} FCFA devrait durer environ {_fmt(jours, 1)} jours."
        if conseils:
            astuces = " ; ".join(f"{c.texte} (+{_fmt(c.jours_gagnes, 1)} j)" for c in conseils)
            msg += f" Pour l'étirer : {astuces}."
    else:
        msg += " Dis-moi combien tu veux recharger (en FCFA) et je te dis combien de temps ça tient."

    return PredictionPrepaye(
        appareils=lignes,
        kwh_jour=round(kwh_jour, 3),
        fcfa_jour=round(fcfa_jour, 2),
        montant_fcfa=montant_fcfa,
        jours=None if jours is None else round(jours, 1),
        prix_moyen_kwh=round(prix_moyen, 2),
        conseils=conseils,
        message=msg,
    )


# --------------------------------------------------------------------------- #
# 10. Prédiction PAR APPAREIL sur les mesures RÉELLES du boîtier              #
# --------------------------------------------------------------------------- #
# Alimentée par `agregation.bilan_appareil` (watts réels -> kWh/jour), et non par des
# relevés saisis à la main. Répond à : « quel appareil va me coûter le plus ce mois ? ».
#
# Attribution du coût sous un barème PROGRESSIF : le prix du kWh n'est pas constant, donc
# le « coût d'un appareil » n'est pas unique. On répartit la facture mensuelle du foyer au
# prorata des kWh de chaque appareil (part de facture = prix MOYEN du foyer). En parallèle
# on donne le prix MARGINAL : ce que réduire cet appareil ferait vraiment économiser.


@dataclass
class ProjectionAppareil:
    device_id: str
    nom: str
    kwh_jour_observe: float        # kWh/jour mesuré (jour en cours extrapolé)
    kwh_jour_prevu: float          # prévision Holt-Winters si assez de recul, sinon = observé
    kwh_mois_projete: float        # kwh_jour * 30
    part_fcfa_mois: float          # part de la facture mensuelle du foyer imputée à l'appareil
    prix_marginal_fcfa_kwh: float  # vrai prix du prochain kWh évité à ce niveau de conso
    fiabilite_pct: float | None    # fiabilité de la prévision (None si historique trop court)
    jours_donnees: int             # nb de jours réellement observés (transparence)


@dataclass
class PredictionFoyer:
    appareils: list[ProjectionAppareil]  # triés par part de facture décroissante
    kwh_jour_total: float
    kwh_mois_projete: float
    facture_mois_projetee_fcfa: float
    bareme: str
    appareil_le_plus_cher: str | None
    message: str


def _kwh_jour_prevu(serie: list[float], observe: float) -> tuple[float, float | None]:
    """Prévision du kWh/jour de l'appareil + fiabilité. Repli sur l'observé si peu de recul."""
    jours_utiles = sum(1 for v in serie if v > 0)
    if jours_utiles < 3:
        return observe, None  # trop peu de vrais jours : la moyenne observée fait foi
    prev = predire(serie)
    return prev.kwh_jour_prevu, prev.fiabilite_pct


def classer_appareils(
    bilans: list[tuple[str, str, list[float], float, int]],
) -> PredictionFoyer:
    """Classe les appareils par coût mensuel projeté, à partir des bilans réels.

    `bilans` : liste de (device_id, nom, serie_kwh_jour, kwh_jour_observe, jours_donnees),
    typiquement construite depuis `agregation.bilan_appareil`. Calcul déterministe.
    """
    projections: list[ProjectionAppareil] = []
    kwh_jour_prevu: dict[str, float] = {}
    for device_id, nom, serie, observe, jours_donnees in bilans:
        prevu, fiab = _kwh_jour_prevu(serie, observe)
        kwh_jour_prevu[device_id] = prevu
        projections.append(ProjectionAppareil(
            device_id=device_id, nom=nom,
            kwh_jour_observe=round(observe, 3),
            kwh_jour_prevu=round(prevu, 3),
            kwh_mois_projete=round(prevu * 30.0, 2),
            part_fcfa_mois=0.0,  # rempli après (dépend du total foyer)
            prix_marginal_fcfa_kwh=0.0,
            fiabilite_pct=fiab,
            jours_donnees=jours_donnees,
        ))

    kwh_jour_total = sum(kwh_jour_prevu.values())
    kwh_mois_total = kwh_jour_total * 30.0
    bareme = tarif_cie.bareme_pour_conso_mensuelle(kwh_mois_total)
    facture_totale = tarif_cie.cout_mensuel(kwh_mois_total, bareme)
    prix_marginal = tarif_cie.prix_marginal_mensuel(kwh_mois_total, bareme)

    # Répartition de la facture au prorata des kWh (prix moyen du foyer).
    for p in projections:
        part_kwh = kwh_jour_prevu[p.device_id] * 30.0
        p.part_fcfa_mois = round(
            facture_totale * (part_kwh / kwh_mois_total) if kwh_mois_total > 0 else 0.0, 2
        )
        p.prix_marginal_fcfa_kwh = prix_marginal

    projections.sort(key=lambda p: p.part_fcfa_mois, reverse=True)
    plus_cher = projections[0] if projections and projections[0].kwh_mois_projete > 0 else None

    if plus_cher is None:
        msg = ("Aucune consommation mesurée pour l'instant. Dès que tes prises envoient des "
               "données, je te dis quel appareil pèse le plus sur ta facture.")
    else:
        msg = (f"À ce rythme, ta facture ce mois-ci serait d'environ "
               f"{_fmt(facture_totale)} FCFA ({bareme.nom}). L'appareil le plus coûteux est "
               f"{plus_cher.nom} : ~{_fmt(plus_cher.kwh_mois_projete, 1)} kWh, soit environ "
               f"{_fmt(plus_cher.part_fcfa_mois)} FCFA. Réduire son usage économise "
               f"{_fmt(plus_cher.prix_marginal_fcfa_kwh)} FCFA par kWh évité.")

    return PredictionFoyer(
        appareils=projections,
        kwh_jour_total=round(kwh_jour_total, 3),
        kwh_mois_projete=round(kwh_mois_total, 2),
        facture_mois_projetee_fcfa=round(facture_totale, 2),
        bareme=bareme.nom,
        appareil_le_plus_cher=plus_cher.nom if plus_cher else None,
        message=msg,
    )
