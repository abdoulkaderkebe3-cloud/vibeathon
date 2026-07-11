"""Calcul d'impact : kWh / FCFA / CO2 évités. Fonctions pures et testables (CA5).

L'impact part de la consommation RÉELLEMENT évitée (puissance coupée x durée), jamais de
valeurs codées en dur. Voir docs/impact.md pour les constantes à sourcer.
"""
from dataclasses import dataclass

from .config import settings


@dataclass
class Impact:
    kwh_evites: float
    fcfa_economises: float
    co2_evite_kg: float


def kwh_evites(watts_coupes: float, duree_h: float) -> float:
    """Énergie évitée en kWh pour une puissance coupée (W) pendant une durée (heures)."""
    if watts_coupes < 0 or duree_h < 0:
        raise ValueError("watts_coupes et duree_h doivent être positifs")
    return (watts_coupes * duree_h) / 1000.0


def compute_impact(
    watts_coupes: float,
    duree_h: float,
    prix_kwh_fcfa: float | None = None,
    co2_kg_par_kwh: float | None = None,
) -> Impact:
    prix = settings.ecowatt_prix_kwh_fcfa if prix_kwh_fcfa is None else prix_kwh_fcfa
    co2 = settings.ecowatt_co2_kg_par_kwh if co2_kg_par_kwh is None else co2_kg_par_kwh
    kwh = kwh_evites(watts_coupes, duree_h)
    return Impact(
        kwh_evites=round(kwh, 4),
        fcfa_economises=round(kwh * prix, 2),
        co2_evite_kg=round(kwh * co2, 4),
    )


def projection(impact: Impact, nb_foyers: int) -> Impact:
    """Projection nationale ('si N foyers le font')."""
    return Impact(
        kwh_evites=round(impact.kwh_evites * nb_foyers, 2),
        fcfa_economises=round(impact.fcfa_economises * nb_foyers, 2),
        co2_evite_kg=round(impact.co2_evite_kg * nb_foyers, 2),
    )
