"""Tests du calcul d'impact (CA5). Fonctions pures, valeurs attendues connues."""
import pytest

from app.impact import compute_impact, kwh_evites, projection


def test_kwh_evites_simple():
    # 1000 W coupés pendant 2 h = 2 kWh
    assert kwh_evites(1000, 2) == 2.0


def test_kwh_evites_zero():
    assert kwh_evites(0, 5) == 0.0


def test_kwh_evites_refuse_negatif():
    with pytest.raises(ValueError):
        kwh_evites(-10, 1)


def test_compute_impact_valeurs():
    imp = compute_impact(1000, 1, prix_kwh_fcfa=79, co2_kg_par_kwh=0.5)
    assert imp.kwh_evites == 1.0
    assert imp.fcfa_economises == 79.0
    assert imp.co2_evite_kg == 0.5


def test_projection():
    imp = compute_impact(1000, 1, prix_kwh_fcfa=79, co2_kg_par_kwh=0.5)
    nat = projection(imp, 10000)
    assert nat.kwh_evites == 10000.0
    assert nat.fcfa_economises == 790000.0
