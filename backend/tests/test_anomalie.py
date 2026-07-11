"""Détection d'anomalie de consommation (appareil qui tire trop -> défaut probable)."""
from app import anomalie
from app.main import _repondre_anomalie


def _dev(nom, watts, etat="on", did="d1"):
    return {"id": did, "nom": nom, "etat": etat, "conso_w": watts}


def test_appareil_normal_pas_d_anomalie():
    assert anomalie.detecter([_dev("Réfrigérateur", 160), _dev("Lampe", 45)]) == []


def test_surconsommation_detectee():
    a = anomalie.detecter([_dev("Réfrigérateur", 620)])
    assert len(a) == 1
    assert "vérifier" in a[0].message and "620" in a[0].message


def test_seuil_par_type():
    # Un fer à repasser à 1200 W est NORMAL (seuil 2200), un frigo à 1200 W est ANORMAL.
    assert anomalie.detecter([_dev("Fer à repasser", 1200)]) == []
    assert len(anomalie.detecter([_dev("Réfrigérateur", 1200)])) == 1


def test_appareil_eteint_ignore():
    assert anomalie.detecter([_dev("Réfrigérateur", 620, etat="off")]) == []


def test_type_inconnu_ignore():
    # Une prise pas encore renommée (« 30A ») n'a pas de type -> pas de faux positif.
    assert anomalie.detecter([_dev("30A", 5000)]) == []


def test_chat_diagnostic_repond():
    # La question de diagnostic est interceptée (pas confiée au LLM) quand il y a des mesures.
    import app.main as m
    orig = m._devices_dicts
    m._devices_dicts = lambda: [_dev("Réfrigérateur", 620)]
    try:
        r = _repondre_anomalie("est-ce qu'un appareil consomme anormalement ?")
        assert r is not None and "Réfrigérateur" in r
        rien = _repondre_anomalie("quelle heure est-il ?")
        assert rien is None  # pas une question de diagnostic
    finally:
        m._devices_dicts = orig
