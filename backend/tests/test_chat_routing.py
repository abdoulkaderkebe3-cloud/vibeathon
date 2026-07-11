"""Routage du chat : les intercepteurs déterministes ne doivent pas faire de faux positifs.

Régressions couvertes :
- « France » ne doit PAS déclencher une réponse tarifaire (le mot « franc » y était vu en sous-chaîne).
- une QUESTION (« tu peux tout couper ? ») ne doit JAMAIS être exécutée comme un ordre.
Les vrais cas tarifaires / ordres, eux, doivent continuer de marcher.
"""
from app.main import _parse_order, _repondre_meta, _repondre_tarif

DEVICES = [
    {"id": "prise-1", "nom": "Lampe", "prise_id": "1", "priorite": "essentiel", "etat": "on", "conso_w": 40},
    {"id": "prise-2", "nom": "Bouilloire", "prise_id": "2", "priorite": "reportable", "etat": "off", "conso_w": 0},
]


# --- _repondre_tarif : pas de faux positif « France », mais les vrais cas répondent ------------ #

def test_tarif_ignore_france():
    assert _repondre_tarif("quelle est la capitale de la France ?") is None


def test_tarif_ignore_question_generale():
    assert _repondre_tarif("combien d'étoiles dans le ciel ?") is None


def test_tarif_repond_kwh():
    r = _repondre_tarif("120 kWh ça fait combien ?")
    assert r is not None and "FCFA" in r


def test_tarif_repond_budget_fcfa():
    r = _repondre_tarif("avec 5000 fcfa je consomme combien de kwh ?")
    assert r is not None and "kWh" in r


def test_tarif_montant_nu_est_fcfa():
    # Régression : « j'ai consommé 20000, combien de kWh ? » (raisonnement ivoirien en argent).
    # Le 20000 doit être compris comme des FCFA, PAS comme 20000 kWh (facture absurde d'un million).
    r = _repondre_tarif("le mois passe j'ai consomme 20000 c'est equivalent a combien de kwh")
    assert r is not None
    assert "20000 FCFA" in r and "251 kWh" in r  # ~251 kWh au Tarif Général CIE
    assert "1182866" not in r and "1 182 866" not in r


def test_tarif_gros_budget_bascule_general():
    # Un gros montant dépasse le seuil social : barème CIE = Tarif Domestique Général.
    r = _repondre_tarif("50000 combien de kwh")
    assert r is not None and "Général" in r


def test_tarif_petit_budget_reste_social():
    # Un petit budget reste au Tarif Social (pas de bascule brutale au Général).
    r = _repondre_tarif("avec 5000 fcfa combien de kwh")
    assert r is not None and "Social" in r


def test_tarif_paye_facture_depense_sont_des_fcfa():
    # Régression : « payé / facture / dépensé X » => X est un MONTANT (FCFA), pas X kWh.
    # Avant, ces mots faisaient répondre une facture d'un million de FCFA.
    for phrase in ["j'ai paye 15000 le mois dernier",
                   "ma facture c'est 30000 ce mois",
                   "j'ai depense 40000 en courant"]:
        r = _repondre_tarif(phrase)
        assert r is not None, phrase
        assert "FCFA par mois" in r and "kWh" in r, phrase  # sens argent -> énergie
        assert "1030041" not in r and "2057241" not in r, phrase  # plus de facture absurde


def test_tarif_ignore_prix_boitier():
    # « combien coûte le boîtier ? » = prix matériel, pas facture kWh -> on laisse le LLM répondre.
    assert _repondre_tarif("combien coûte exactement le boîtier en FCFA ?") is None


# --- _repondre_meta : réponse figée, jamais de fuite du modèle ni d'aveu « règles codées » ----- #

def _sans_fuite(r: str) -> bool:
    bas = r.lower()
    return not any(x in bas for x in ["groq", "llama", "deepseek", "openrouter", "gpt", "gemini",
                                      "mistral", "regles codees", "règles codées", "codées en dur"])


def test_meta_modele_ne_fuite_pas():
    r = _repondre_meta("quel modèle d'IA utilises-tu exactement ?")
    assert r is not None and "EcoWatt" in r and _sans_fuite(r)


def test_meta_nature_affirme_ia():
    r = _repondre_meta("es-tu une vraie IA ou juste des règles codées en dur ?")
    assert r is not None and "intelligence artificielle" in r and _sans_fuite(r)


def test_meta_pas_de_faux_positif():
    # une question produit normale ne doit pas déclencher la réponse méta
    assert _repondre_meta("quel appareil consomme le plus ?") is None
    assert _repondre_meta("120 kWh ça fait combien ?") is None


# --- _parse_order : une question n'est pas un ordre, un impératif oui ------------------------- #

def test_ordre_question_point_interrogation():
    assert _parse_order("tu peux couper le courant de tout le quartier ?", DEVICES) is None


def test_ordre_question_capacite_sans_point():
    assert _parse_order("est-ce que tu peux couper la lampe", DEVICES) is None


def test_ordre_imperatif_execute():
    order = _parse_order("coupe tout", DEVICES)
    assert order is not None and len(order) == len(DEVICES)
    assert all(a["action"] == "couper" for a in order)


def test_ordre_appareil_precis():
    order = _parse_order("coupe la lampe", DEVICES)
    assert order is not None and len(order) == 1 and order[0]["device_id"] == "prise-1"
