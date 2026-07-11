"""Tests de l'agrégation des mesures réelles (watts -> kWh/jour) et de la prédiction foyer."""
from datetime import datetime, timedelta

import pytest

from app import agregation, prediction


def _serie_watts(debut: datetime, watts: float, minutes: int, pas_s: int = 60):
    """Génère des mesures régulières (t, watts) sur `minutes` minutes."""
    n = int(minutes * 60 / pas_s) + 1
    return [(debut + timedelta(seconds=i * pas_s), watts) for i in range(n)]


def test_integration_1000w_pendant_1h_donne_1kwh():
    debut = datetime(2026, 7, 1, 8, 0, 0)
    mesures = _serie_watts(debut, 1000.0, minutes=60)
    par_jour = agregation.energie_par_jour(mesures)
    assert par_jour[debut.date()] == pytest.approx(1.0, abs=0.01)


def test_moins_de_deux_mesures_donne_rien():
    assert agregation.energie_par_jour([]) == {}
    assert agregation.energie_par_jour([(datetime(2026, 7, 1, 8), 500.0)]) == {}


def test_trou_superieur_a_intervalle_max_nest_pas_integre():
    # Deux mesures espacées de 2 h (> 5 min) : le silence n'est pas facturé.
    debut = datetime(2026, 7, 1, 8, 0, 0)
    mesures = [(debut, 1000.0), (debut + timedelta(hours=2), 1000.0)]
    par_jour = agregation.energie_par_jour(mesures)
    assert par_jour == {}


def test_energie_repartie_sur_deux_jours():
    # 1000 W en continu de 23h à 1h => 1 kWh réparti à cheval sur deux dates.
    debut = datetime(2026, 7, 1, 23, 0, 0)
    mesures = _serie_watts(debut, 1000.0, minutes=120)
    par_jour = agregation.energie_par_jour(mesures)
    assert set(par_jour) == {debut.date(), (debut + timedelta(hours=2)).date()}
    assert sum(par_jour.values()) == pytest.approx(2.0, abs=0.02)


def test_serie_journaliere_comble_les_jours_manquants():
    from datetime import date
    kwh = {date(2026, 7, 1): 2.0, date(2026, 7, 3): 4.0}  # le 2 juillet manque
    serie, jours = agregation.serie_journaliere(kwh)
    assert serie == [2.0, 0.0, 4.0]
    assert len(jours) == 3


def test_kwh_jour_observe_extrapole_la_journee_en_cours():
    from datetime import date
    jour = date(2026, 7, 1)
    # 0,5 kWh mesurés, il est midi (moitié de journée) => ~1,0 kWh projeté sur 24 h.
    kwh = {jour: 0.5}
    maintenant = datetime(2026, 7, 1, 12, 0, 0)
    assert agregation.kwh_jour_observe(kwh, maintenant) == pytest.approx(1.0, abs=0.05)


def test_kwh_jour_observe_jour_passe_non_extrapole():
    from datetime import date
    kwh = {date(2026, 7, 1): 3.0}
    maintenant = datetime(2026, 7, 3, 12, 0, 0)  # 2 jours plus tard : journée complète
    assert agregation.kwh_jour_observe(kwh, maintenant) == pytest.approx(3.0)


def test_bilan_appareil_bout_en_bout():
    debut = datetime(2026, 7, 1, 8, 0, 0)
    mesures = _serie_watts(debut, 2000.0, minutes=60)  # 2 kWh en 1 h
    bilan = agregation.bilan_appareil(
        "prise-1", mesures, maintenant=datetime(2026, 7, 2, 12, 0, 0),
    )
    assert bilan.kwh_total == pytest.approx(2.0, abs=0.02)
    assert bilan.device_id == "prise-1"


def test_classer_appareils_trie_par_cout_et_designe_le_plus_cher():
    # Climatiseur (10 kWh/j) vs lampe (0,1 kWh/j) : le clim doit être en tête.
    bilans = [
        ("prise-1", "Lampe", [0.1] * 7, 0.1, 7),
        ("prise-2", "Climatiseur", [10.0] * 7, 10.0, 7),
    ]
    foyer = prediction.classer_appareils(bilans)
    assert foyer.appareil_le_plus_cher == "Climatiseur"
    assert foyer.appareils[0].nom == "Climatiseur"
    assert foyer.appareils[0].part_fcfa_mois > foyer.appareils[1].part_fcfa_mois
    assert foyer.facture_mois_projetee_fcfa > 0


def test_classer_appareils_sans_conso_reste_neutre():
    foyer = prediction.classer_appareils([("prise-1", "Lampe", [0.0] * 7, 0.0, 0)])
    assert foyer.appareil_le_plus_cher is None
    assert "Aucune consommation" in foyer.message


def test_part_facture_somme_au_total_foyer():
    # La somme des parts par appareil doit égaler la facture projetée du foyer (répartition exacte).
    bilans = [
        ("prise-1", "Frigo", [1.3] * 7, 1.3, 7),
        ("prise-2", "Télé", [0.4] * 7, 0.4, 7),
        ("prise-3", "Ventilo", [0.6] * 7, 0.6, 7),
    ]
    foyer = prediction.classer_appareils(bilans)
    somme_parts = sum(a.part_fcfa_mois for a in foyer.appareils)
    assert somme_parts == pytest.approx(foyer.facture_mois_projetee_fcfa, abs=0.1)
