"""Tests du cerveau : parsing des décisions + logique de priorité (CA3, CA4)."""
import pytest

from app.brain import coupables, degraded_decision, is_peak, parse_decision


def test_parse_decision_valide():
    d = parse_decision({"action": "couper", "device_id": "kettle-1", "raison": "pic en pointe"})
    assert d["action"] == "couper"
    assert d["device_id"] == "kettle-1"


def test_parse_decision_action_invalide():
    with pytest.raises(ValueError):
        parse_decision({"action": "exploser", "device_id": "x"})


def test_parse_decision_device_requis_pour_couper():
    with pytest.raises(ValueError):
        parse_decision({"action": "couper"})


def test_parse_decision_garder_sans_device_ok():
    d = parse_decision({"action": "garder", "raison": "rien à faire"})
    assert d["device_id"] is None


def test_coupables_exclut_essentiel():
    devices = [
        {"id": "lamp", "nom": "Lampe", "priorite": "essentiel", "etat": "on", "conso_w": 40},
        {"id": "kettle", "nom": "Bouilloire", "priorite": "reportable", "etat": "on", "conso_w": 1500},
    ]
    ids = [d["id"] for d in coupables(devices)]
    assert "lamp" not in ids       # l'essentiel n'est jamais candidat (CA4)
    assert "kettle" in ids


def test_degraded_coupe_le_plus_gros_reportable_en_pointe(monkeypatch):
    from app import brain
    monkeypatch.setattr(brain.settings, "ecowatt_peak_start", 0)
    monkeypatch.setattr(brain.settings, "ecowatt_peak_end", 24)  # toujours en pointe
    devices = [
        {"id": "lamp", "nom": "Lampe", "priorite": "essentiel", "etat": "on", "conso_w": 40},
        {"id": "kettle", "nom": "Bouilloire", "priorite": "reportable", "etat": "on", "conso_w": 1500},
        {"id": "fan", "nom": "Ventilateur", "priorite": "confort", "etat": "on", "conso_w": 60},
    ]
    dec = degraded_decision(devices, hour=19)
    assert dec["action"] == "couper"
    assert dec["device_id"] == "kettle"   # le plus gros reportable/confort


def test_is_peak_fenetre_normale(monkeypatch):
    from app import brain
    monkeypatch.setattr(brain.settings, "ecowatt_peak_start", 18)
    monkeypatch.setattr(brain.settings, "ecowatt_peak_end", 22)
    assert is_peak(19) is True
    assert is_peak(9) is False
