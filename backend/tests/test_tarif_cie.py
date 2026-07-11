"""Tests du barème CIE (tarif social) — conversion kWh ⇄ FCFA."""
import pytest

from app import tarif_cie
from app.tarif_cie import TARIF_SOCIAL


def test_facture_zero_kwh_ne_paie_que_la_prime_fixe():
    f = tarif_cie.facture_bimestre(0.0)
    assert f.total_fcfa == TARIF_SOCIAL.prime_fixe_bimestre_fcfa
    assert f.cout_energie_fcfa == 0.0
    assert f.prix_moyen_fcfa_kwh == 0.0


def test_facture_dans_la_tranche_1():
    # 50 kWh < 80 -> tout au tarif réduit tranche 1.
    f = tarif_cie.facture_bimestre(50.0)
    attendu = 559.0 + 50.0 * 28.84
    assert f.cout_energie_fcfa == pytest.approx(50.0 * 28.84, abs=0.01)
    assert f.total_fcfa == pytest.approx(attendu, abs=0.01)
    assert len(f.lignes) == 1


def test_facture_franchit_la_tranche_2():
    # 100 kWh = 80 @ 28.84 + 20 @ 59.19.
    f = tarif_cie.facture_bimestre(100.0)
    energie = 80.0 * 28.84 + 20.0 * 59.19
    assert f.cout_energie_fcfa == pytest.approx(energie, abs=0.01)
    assert f.total_fcfa == pytest.approx(559.0 + energie, abs=0.01)
    assert len(f.lignes) == 2
    assert f.lignes[0].kwh == 80.0
    assert f.lignes[1].kwh == 20.0


def test_progressivite_le_kwh_marginal_augmente():
    # Le prix marginal doit passer de 28.84 (tranche 1) à 59.19 (tranche 2).
    assert tarif_cie.prix_marginal_bimestre(50.0) == pytest.approx(28.84, abs=0.01)
    assert tarif_cie.prix_marginal_bimestre(120.0) == pytest.approx(59.19, abs=0.01)


def test_inverse_budget_est_coherent_avec_la_facture():
    # kwh -> facture -> budget doit redonner ~ les mêmes kWh (aller-retour).
    kwh = 130.0
    total = tarif_cie.cout_bimestre(kwh)
    kwh_retrouve = tarif_cie.kwh_pour_budget_bimestre(total)
    assert kwh_retrouve == pytest.approx(kwh, abs=0.1)


def test_budget_insuffisant_pour_la_prime_fixe():
    # Un budget sous la prime fixe ne permet aucun kWh.
    assert tarif_cie.kwh_pour_budget_bimestre(100.0) == 0.0


def test_vue_mensuelle_est_la_moitie_du_bimestre():
    kwh_mois = 40.0
    cout_mois = tarif_cie.cout_mensuel(kwh_mois)
    cout_bim = tarif_cie.cout_bimestre(kwh_mois * 2.0)
    assert cout_mois == pytest.approx(cout_bim / 2.0, abs=0.01)


def test_kwh_negatif_leve_une_erreur():
    with pytest.raises(ValueError):
        tarif_cie.facture_bimestre(-5.0)
