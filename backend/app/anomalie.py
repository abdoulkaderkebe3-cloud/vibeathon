"""Détection d'anomalie de consommation (fonctions pures, testables).

Objectif : quand un appareil tire une puissance BIEN au-dessus de la normale de son type,
c'est souvent le signe d'un défaut naissant (moteur qui force, résistance qui grille,
mauvais câblage) → risque de surchauffe et facture qui grimpe. L'IA le repère et conseille
de faire vérifier l'appareil, SANS le couper d'office (à ne pas confondre avec le délestage
heure de pointe, qui, lui, coupe volontairement un appareil sain).

Choix de calibration : un SEUIL absolu par type d'appareil (≈ 2 à 3× la puissance normale),
volontairement prudent pour éviter les faux positifs devant le jury. Regroupé dans une seule
table pour un réglage trivial. Le type est déduit du nom via `prediction.ALIAS`.
"""
from __future__ import annotations

import unicodedata
from dataclasses import dataclass

from . import prediction

# Puissance (W) au-delà de laquelle, POUR CE TYPE, la consommation est jugée anormale.
# ≈ 2-3× la puissance normale de l'appareil : au-dessus, un défaut est probable.
SEUIL_ANOMALIE_W: dict[str, float] = {
    "ampoule led": 40, "ampoule": 150, "ventilateur": 160, "television": 300,
    "decodeur": 60, "climatiseur": 2000, "fer a repasser": 2200, "bouilloire": 2600,
    "chargeur": 40, "ordinateur": 250, "machine a laver": 3000, "pompe a eau": 1600,
    "refrigerateur": 400, "congelateur": 500,
}

# Puissance « normale » de référence citée dans le message (crête plausible du type).
NORMALE_W: dict[str, float] = {
    "ampoule led": 10, "ampoule": 60, "ventilateur": 60, "television": 120,
    "decodeur": 15, "climatiseur": 900, "fer a repasser": 1000, "bouilloire": 1500,
    "chargeur": 5, "ordinateur": 60, "machine a laver": 500, "pompe a eau": 750,
    "refrigerateur": 150, "congelateur": 200,
}


@dataclass(frozen=True)
class Anomalie:
    device_id: str
    nom: str
    watts: float
    normale_w: float
    message: str


def _sans_accent(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s.lower()) if unicodedata.category(c) != "Mn")


def type_appareil(nom: str) -> str | None:
    """Type canonique déduit d'un nom d'appareil (via les alias de prediction). None si inconnu."""
    n = _sans_accent(nom).strip()
    meilleur, longueur = None, 0
    for canon, aliases in prediction.ALIAS.items():
        for a in aliases:
            if a in n and len(a) > longueur:
                meilleur, longueur = canon, len(a)
    return meilleur


def _anomalie_pour(device: dict) -> Anomalie | None:
    """Anomalie si l'appareil est allumé et tire nettement plus que la normale de son type."""
    if device.get("etat") != "on":
        return None
    watts = float(device.get("conso_w") or 0)
    canon = type_appareil(str(device.get("nom", "")))
    if canon is None or canon not in SEUIL_ANOMALIE_W:
        return None
    if watts <= SEUIL_ANOMALIE_W[canon]:
        return None
    normale = NORMALE_W.get(canon, SEUIL_ANOMALIE_W[canon] / 2.0)
    libelle = prediction._libelle(canon)
    message = (
        f"⚠️ {device['nom']} tire {round(watts)} W, bien au-dessus de la normale d'un(e) "
        f"{libelle} (~{round(normale)} W). Ça peut venir d'un défaut (moteur, résistance ou "
        f"câblage) : fais-le vérifier, et coupe-le en cas de doute (risque de surchauffe)."
    )
    return Anomalie(
        device_id=str(device.get("id", "")),
        nom=str(device.get("nom", "")),
        watts=round(watts, 1),
        normale_w=normale,
        message=message,
    )


def detecter(devices: list[dict]) -> list[Anomalie]:
    """Toutes les anomalies de consommation dans l'état courant (appareils allumés)."""
    out = []
    for d in devices:
        a = _anomalie_pour(d)
        if a is not None:
            out.append(a)
    return out
