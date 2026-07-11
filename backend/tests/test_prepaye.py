"""Tests du calcul prépayé (durée d'une recharge) et du parseur d'appareils."""
import pytest

from app import prediction
from app.main import _parse_appareils, _parse_montant_fcfa, _repondre_prepaye

# ---------- calcul déterministe ----------

def test_kwh_jour_appareil_simple():
    p = prediction.predire_prepaye([("ventilateur", 8, 1)])
    # 60 W * 8h = 0,48 kWh/j
    assert p.kwh_jour == pytest.approx(0.48, abs=0.001)


def test_refrigerateur_est_cyclique():
    p = prediction.predire_prepaye([("refrigerateur", 24, 1)])
    assert p.kwh_jour == pytest.approx(1.3, abs=0.001)  # conso fixe, pas puissance x heures


def test_quantite_multiplie():
    p = prediction.predire_prepaye([("ampoule led", 5, 3)])
    # 10 W * 5h * 3 = 0,15 kWh/j
    assert p.kwh_jour == pytest.approx(0.15, abs=0.001)


def test_duree_recharge_foyer_type():
    appareils = [("ventilateur", 8, 1), ("television", 4, 1), ("ampoule led", 5, 3), ("refrigerateur", 24, 1)]
    p = prediction.predire_prepaye(appareils, montant_fcfa=1000)
    assert p.kwh_jour == pytest.approx(2.33, abs=0.05)
    assert p.jours is not None
    # ~10 j avec le barème social progressif (moyenne ~42 FCFA/kWh, tranche 1 à 28,84).
    assert 8 <= p.jours <= 12
    assert "durer" in p.message


def test_grosse_conso_bascule_au_tarif_general():
    # Climatiseur 10h/j => ~300 kWh/mois > 100 => tarif général (plus cher), recharge très courte.
    p = prediction.predire_prepaye([("climatiseur", 10, 1), ("refrigerateur", 24, 1)], montant_fcfa=1000)
    assert "Général" in p.message
    assert p.jours is not None and p.jours < 3


def test_petit_foyer_reste_au_social():
    p = prediction.predire_prepaye([("ventilateur", 8, 1), ("television", 4, 1)], montant_fcfa=1000)
    assert "Social" in p.message


def test_sans_montant_demande_le_montant():
    p = prediction.predire_prepaye([("ventilateur", 8, 1)])
    assert p.jours is None
    assert "recharger" in p.message.lower()


def test_conseils_chiffres_present_si_gros_poste():
    appareils = [("climatiseur", 8, 1), ("refrigerateur", 24, 1)]
    p = prediction.predire_prepaye(appareils, montant_fcfa=2000)
    assert p.conseils                  # la clim est un gros poste modulable
    assert all(c.jours_gagnes >= 0.3 for c in p.conseils)


# ---------- parseur ----------

def test_parse_appareils_liste_naturelle():
    a = _parse_appareils("un ventilateur 8h, une television 4h, 3 ampoules LED 5h et un refrigerateur en continu")
    assert a is not None
    noms = {x[0] for x in a}
    assert {"ventilateur", "television", "ampoule led", "refrigerateur"} <= noms
    # quantité des ampoules = 3
    amp = next(x for x in a if x[0] == "ampoule led")
    assert amp[2] == 3


def test_parse_appareils_incomplet_renvoie_none():
    # Un appareil non cyclique sans heures => parse non fiable => None (le LLM posera la question).
    assert _parse_appareils("j'ai une television et un ventilateur") is None


def test_parse_montant_depuis_texte():
    assert _parse_montant_fcfa("je recharge 1000 fcfa") == 1000
    assert _parse_montant_fcfa("je mets 2 500 FCFA sur mon compteur") == 2500
    assert _parse_montant_fcfa("bonjour") is None


def test_repondre_prepaye_bout_en_bout():
    history = [
        {"role": "user", "content": "je veux recharger 1000 fcfa sur mon compteur a carte"},
        {"role": "assistant", "content": "Quels appareils utilises-tu ?"},
    ]
    r = _repondre_prepaye("un ventilateur 8h, une television 4h, 3 ampoules led 5h, un frigo en continu", history)
    assert r is not None
    assert "jours" in r
    assert "1 000" in r or "1000" in r


def test_repondre_prepaye_hors_contexte_renvoie_none():
    # Appareils listés mais aucun indice prépayé/tarif => pas pour nous.
    assert _repondre_prepaye("j'aime bien mon ventilateur 8h", None) is None
