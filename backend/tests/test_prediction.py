"""Tests de la prédiction et de la comparaison mensuelle."""
import pytest

from app import prediction
from app.prediction import Unite


def test_en_kwh_laisse_les_kwh_intacts():
    assert prediction.en_kwh([5.0, 3.0, 0.0], Unite.kwh) == [5.0, 3.0, 0.0]


def test_en_kwh_convertit_les_fcfa_en_kwh_positifs():
    kwh = prediction.en_kwh([1000.0, 1000.0], Unite.fcfa)
    assert all(v > 0 for v in kwh)
    assert len(kwh) == 2


def test_prevision_serie_constante_reste_constante():
    # Série plate à 4 kWh/jour : la prévision de demain doit rester ~4.
    prev = prediction.predire([4.0] * 14)
    assert prev.kwh_jour_prevu == pytest.approx(4.0, abs=0.5)
    assert prev.cout_semaine_fcfa > 0


def test_recommander_produit_des_actions_quand_on_depasse_le_budget():
    # Conso élevée + petit budget -> l'app doit proposer des leviers d'économie.
    reco = prediction.recommander([8.0] * 14, Unite.kwh, budget_mensuel_fcfa=5000.0)
    assert not reco.sur_la_bonne_voie
    assert len(reco.actions) > 0
    assert reco.economie_mois_fcfa > 0


def test_recommander_sur_la_bonne_voie_si_petite_conso():
    reco = prediction.recommander([1.0] * 14, Unite.kwh, budget_mensuel_fcfa=20000.0)
    assert reco.sur_la_bonne_voie


def test_comparer_hausse():
    c = prediction.comparer_mois(120.0, 90.0, Unite.kwh)
    assert c.en_hausse
    assert c.variation_kwh == pytest.approx(30.0)
    assert c.variation_fcfa > 0
    assert "hausse" in c.message.lower()


def test_comparer_baisse():
    c = prediction.comparer_mois(70.0, 100.0, Unite.kwh)
    assert not c.en_hausse
    assert c.variation_kwh == pytest.approx(-30.0)
    assert c.variation_fcfa < 0


def test_comparer_stable():
    c = prediction.comparer_mois(80.0, 80.0, Unite.kwh)
    assert c.variation_kwh == pytest.approx(0.0)
    assert "stable" in c.message.lower()


def test_comparer_en_fcfa_remonte_aux_kwh():
    c = prediction.comparer_mois(6000.0, 4000.0, Unite.fcfa)
    assert c.kwh_courant > c.kwh_precedent
    assert c.en_hausse
