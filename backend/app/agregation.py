"""Agrégation des mesures réelles du boîtier en énergie (kWh) par jour et par appareil.

C'est le CHAÎNON MANQUANT entre les mesures brutes du boîtier ESP32 et la prédiction :
la prise envoie des **watts instantanés** (une valeur toutes les ~1 s), stockés dans la table
`Measurement`. Or on ne prédit pas des watts, on prédit de l'**énergie consommée** (kWh).
Ce module intègre les watts dans le temps pour reconstruire la consommation réelle, jour par
jour, appareil par appareil, à partir de ce que le boîtier a vraiment vu.

Principe (intégration temporelle) : entre deux mesures consécutives à t1 et t2, on estime
l'énergie par la méthode des trapèzes  ->  Wh = (W1 + W2) / 2 * (t2 - t1) / 3600.
On **plafonne** l'écart (t2 - t1) : si le boîtier a été débranché plusieurs heures, on ne
compte pas tout cet intervalle comme si l'appareil consommait la dernière valeur connue.

Fuseau : les timestamps sont en UTC (`datetime.utcnow`). Abidjan étant à UTC+0 toute l'année,
UTC = heure locale : le regroupement « par jour » est donc directement correct, sans conversion.

Fonctions pures et testables (même esprit que impact.py / prediction.py). La seule fonction qui
touche la base est isolée en fin de fichier (`mesures_par_appareil`).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta

# Au-delà de cet écart entre deux mesures, on considère qu'il y a eu un TROU (boîtier
# débranché, WiFi coupé) et on ne l'intègre pas : on ne facture pas un silence.
INTERVALLE_MAX_S = 300.0  # 5 min ; les prises émettent ~1 mesure/s en marche normale

# En dessous de cette fraction de journée écoulée, on n'extrapole pas la journée en cours
# (trop peu de recul -> projection trop bruyante). On la renvoie telle quelle (kWh partiel).
FRACTION_JOUR_MIN = 1.0 / 24.0  # au moins ~1 h de données dans la journée


@dataclass
class EnergieAppareil:
    """Bilan énergétique reconstruit pour un appareil à partir des mesures réelles."""
    device_id: str
    kwh_par_jour: dict[date, float]      # énergie mesurée, par date (jour partiel inclus tel quel)
    serie: list[float]                   # série continue kWh/jour (jours manquants = 0.0)
    jours: list[date]                    # dates correspondant à `serie`
    kwh_total: float                     # somme mesurée sur la fenêtre
    kwh_jour_observe: float              # kWh/jour « courant » (dernier jour extrapolé si partiel)


def energie_par_jour(
    mesures: list[tuple[datetime, float]],
    intervalle_max_s: float = INTERVALLE_MAX_S,
) -> dict[date, float]:
    """Intègre une série de (timestamp, watts) en kWh consommés par jour.

    `mesures` n'a pas besoin d'être trié : on le trie par temps. Chaque tranche d'énergie
    est imputée au jour de son instant de départ (les tranches durent au plus quelques
    secondes en marche normale, l'imprécision de bord est négligeable).
    """
    if len(mesures) < 2:
        return {}
    points = sorted(mesures, key=lambda p: p[0])
    kwh: dict[date, float] = {}
    for (t1, w1), (t2, w2) in zip(points, points[1:], strict=False):
        dt_s = (t2 - t1).total_seconds()
        if dt_s <= 0 or dt_s > intervalle_max_s:
            continue  # trou (débranché) ou horodatage incohérent : on n'intègre pas
        wh = (max(0.0, w1) + max(0.0, w2)) / 2.0 * dt_s / 3600.0
        jour = t1.date()
        kwh[jour] = kwh.get(jour, 0.0) + wh / 1000.0
    return kwh


def serie_journaliere(
    kwh_par_jour: dict[date, float],
    fin: date | None = None,
    jours: int | None = None,
) -> tuple[list[float], list[date]]:
    """Transforme le dict {jour: kWh} en série continue (jours manquants comblés à 0.0).

    Une série continue et régulièrement espacée est ce qu'attend la prévision
    (`prediction.predire`) : un jour sans mesure vaut 0 kWh, pas un jour absent.
    """
    if not kwh_par_jour:
        return [], []
    debut_data = min(kwh_par_jour)
    fin = fin or max(kwh_par_jour)
    debut = debut_data if jours is None else max(debut_data, fin - timedelta(days=jours - 1))
    n = (fin - debut).days + 1
    if n <= 0:
        return [], []
    dates = [debut + timedelta(days=i) for i in range(n)]
    return [round(kwh_par_jour.get(d, 0.0), 4) for d in dates], dates


def _fraction_jour_ecoulee(jour: date, maintenant: datetime) -> float:
    """Part de la journée `jour` déjà écoulée à l'instant `maintenant` (0 < f <= 1).

    Sert à extrapoler la conso du jour EN COURS : 0,6 kWh mesurés en 6 h => ~2,4 kWh projetés
    sur la journée. Pour un jour passé, la journée est complète (f = 1)."""
    if maintenant.date() > jour:
        return 1.0
    if maintenant.date() < jour:
        return 0.0
    secondes = (maintenant - datetime(jour.year, jour.month, jour.day)).total_seconds()
    return min(1.0, max(0.0, secondes / 86400.0))


def kwh_jour_observe(
    kwh_par_jour: dict[date, float],
    maintenant: datetime | None = None,
) -> float:
    """Estime le kWh/jour « courant » de l'appareil à partir du dernier jour mesuré.

    Si le dernier jour est la journée en cours (partielle), on l'extrapole au prorata des
    heures écoulées pour ne pas sous-estimer. Robuste au démarrage (ESP32 branché depuis
    peu) : on n'a pas besoin de 14 jours d'historique pour donner une projection utile.
    """
    if not kwh_par_jour:
        return 0.0
    maintenant = maintenant or datetime.utcnow()
    dernier = max(kwh_par_jour)
    kwh = kwh_par_jour[dernier]
    frac = _fraction_jour_ecoulee(dernier, maintenant)
    if dernier == maintenant.date() and frac >= FRACTION_JOUR_MIN:
        return round(kwh / frac, 4)  # journée en cours : projetée sur 24 h
    return round(kwh, 4)


def bilan_appareil(
    device_id: str,
    mesures: list[tuple[datetime, float]],
    *,
    fin: date | None = None,
    jours: int | None = None,
    maintenant: datetime | None = None,
    intervalle_max_s: float = INTERVALLE_MAX_S,
) -> EnergieAppareil:
    """Reconstruit le bilan énergétique complet d'un appareil depuis ses mesures brutes."""
    maintenant = maintenant or datetime.utcnow()
    par_jour = energie_par_jour(mesures, intervalle_max_s)
    serie, dates = serie_journaliere(par_jour, fin=fin or maintenant.date(), jours=jours)
    return EnergieAppareil(
        device_id=device_id,
        kwh_par_jour=par_jour,
        serie=serie,
        jours=dates,
        kwh_total=round(sum(par_jour.values()), 4),
        kwh_jour_observe=kwh_jour_observe(par_jour, maintenant),
    )


# --------------------------------------------------------------------------- #
#  Accès base de données (seule fonction non pure)                            #
# --------------------------------------------------------------------------- #

def mesures_par_appareil(
    depuis: datetime | None = None,
) -> dict[str, list[tuple[datetime, float]]]:
    """Lit la table Measurement et regroupe les (timestamp, watts) par appareil.

    `depuis` limite la fenêtre (ex. les 30 derniers jours) pour ne pas relire tout l'historique.
    Import local de la couche DB pour garder le reste du module pur et testable sans base.
    """
    from sqlmodel import select

    from .db import get_session
    from .models import Measurement

    par_appareil: dict[str, list[tuple[datetime, float]]] = {}
    with get_session() as s:
        requete = select(Measurement)
        if depuis is not None:
            requete = requete.where(Measurement.timestamp >= depuis)
        for m in s.exec(requete.order_by(Measurement.timestamp)).all():
            par_appareil.setdefault(m.device_id, []).append((m.timestamp, m.watts))
    return par_appareil
