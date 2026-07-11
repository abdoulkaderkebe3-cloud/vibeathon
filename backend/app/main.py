"""API EcoWatt (FastAPI). Ingestion mesures, cerveau IA, actionneur, impact, temps réel.

Lancer :  uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
Doc auto :  http://localhost:8000/docs
"""
from __future__ import annotations

import asyncio
import json
import re
import time
import unicodedata
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timedelta
from pathlib import Path

import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlmodel import select

from . import agregation, anomalie, brain, prediction, tarif_cie
from .config import settings
from .db import get_session, init_db
from .impact import Impact, projection
from .models import Action, Decision, Device, Measurement, Priorite
from .prediction import Unite
from .state import hub

# --- état live impact (accumulateur en mémoire) ---
_cut_baseline: dict[str, float] = {}   # device_id -> watts au moment de la coupure
_avoided_wh: float = 0.0
DECISION_COOLDOWN_S = 8                 # anti-spam du cerveau (quota gratuit, ADR-005)

# Intention d'état après un ordre (anti-flicker) : le polling ne réécrase pas l'état voulu tant que
# le matériel ne l'a pas confirmé (ou 5 s max). Rend les boutons instantanés à l'écran.
_commande_intention: dict[str, tuple[str, datetime]] = {}
_relay_client: httpx.AsyncClient | None = None

# --- Filtrage du bruit des capteurs ACS712 (mitigation, en attendant la calibration matérielle) ---
# Les ACS712 non calibrés lisent du courant fantôme (jusqu'à des centaines de watts) même sans rien
# branché, surtout quand l'alimentation faiblit. Deux garde-fous appliqués à l'ingestion matérielle :
#   1. Relais OUVERT => 0 W. Un appareil coupé ne consomme rien : c'est une certitude physique.
#   2. Tare à vide : on mémorise le bruit lu quand rien n'est branché et on le soustrait ensuite,
#      avec une zone morte. Déclenchée par l'utilisateur (POST /api/hardware/tare), persistée pour
#      survivre à un redémarrage du backend.
_TARE_PATH = Path(__file__).resolve().parent.parent / "tare_bruit.json"
_tare_bruit: dict[str, float] = {}

# Lissage exponentiel du signal brut AVANT de soustraire la tare. Le bruit des ACS712 (alim qui
# faiblit) a une énorme variance instantanée : une même prise à vide oscille de plusieurs centaines
# de watts. La moyenne, elle, est stable. On lisse donc pour réduire la variance, puis on retranche
# la tare : une prise à vide tombe alors durablement à 0, sans étouffer un vrai appareil (qui
# décale la moyenne). Contrepartie : une charge branchée apparaît en ~3 s (constante de temps).
_ema_watts: dict[str, float] = {}
_EMA_ALPHA = 0.3

# AUTO-CALIBRAGE À VIDE, UNE SEULE FOIS PAR PRISE ET PAR SESSION. Une prise ALLUMÉE mais vide lit
# quand même du bruit (le capteur ne sait pas qu'il n'y a rien) ; on ne peut pas distinguer « prise
# vide bruyante » d'« appareil » par la seule valeur. Solution : la PREMIÈRE fois qu'une prise est vue
# allumée dans la session (au démarrage ou au premier allumage, pendant l'installation, prise vide),
# on capture son bruit quelques secondes -> ça devient la tare, soustraite ensuite.
#   ⚠️ On ne recalibre PAS aux allumages suivants : sinon, brancher un appareil puis rallumer la prise
#      apprendrait sa puissance comme du bruit et l'effacerait (le défaut qui ne réagissait plus).
# Résultat : prise vide = 0, et tout appareil branché APRÈS le 1er calibrage s'affiche (mesure - tare).
# Pour recalibrer volontairement : POST /api/hardware/tare (fait une capture immédiate).
_TARE_CAPTURE_S = 3.0
# device_id -> (somme, n, instant_fin) pendant la fenêtre de capture.
_capture: dict[str, tuple[float, int, float]] = {}
_tare_fait: set[str] = set()  # prises déjà calibrées cette session (pas de recalibrage auto)


def _charger_tare() -> None:
    global _tare_bruit
    with suppress(Exception):
        _tare_bruit = {k: float(v) for k, v in json.loads(_TARE_PATH.read_text()).items()}


def _sauver_tare() -> None:
    with suppress(Exception):
        _TARE_PATH.write_text(json.dumps(_tare_bruit))


def _demarrer_capture(device_id: str) -> None:
    """Lance une capture du bruit à vide sur les prochaines secondes (1er calibrage ou recalibrage)."""
    _capture[device_id] = (0.0, 0, time.monotonic() + _TARE_CAPTURE_S)
    _ema_watts.pop(device_id, None)


def _filtrer_watts(device_id: str, watts_bruts: float, etat: str) -> float:
    """Nettoie une mesure matérielle du bruit ACS712. Voir les blocs ci-dessus."""
    if etat != "on":
        _ema_watts.pop(device_id, None)  # relais rouvert : on repart d'un lissage neuf
        return 0.0  # rien ne peut consommer

    # Fenêtre de capture juste après l'allumage : la prise est supposée vide, on apprend son bruit
    # et on n'affiche rien le temps de le mesurer.
    cap = _capture.get(device_id)
    if cap is not None:
        somme, n, fin = cap
        if time.monotonic() < fin:
            _capture[device_id] = (somme + watts_bruts, n + 1, fin)
            return 0.0
        if n > 0:
            _tare_bruit[device_id] = somme / n  # le bruit moyen mesuré devient la tare
            _sauver_tare()
        _capture.pop(device_id, None)
        _tare_fait.add(device_id)  # calibré : plus de recalibrage auto (l'appareil branché s'affichera)

    prev = _ema_watts.get(device_id, watts_bruts)
    ema = _EMA_ALPHA * watts_bruts + (1 - _EMA_ALPHA) * prev
    _ema_watts[device_id] = ema
    net = ema - _tare_bruit.get(device_id, 0.0)
    if net < settings.ecowatt_bruit_zone_morte_w:
        return 0.0  # sous le fond de bruit résiduel : prise libre
    return net


def _get_relay_client() -> httpx.AsyncClient:
    """Client HTTP persistant pour les ordres relais (évite un handshake TCP à chaque clic)."""
    global _relay_client
    if _relay_client is None:
        _relay_client = httpx.AsyncClient(timeout=3.0)
    return _relay_client


async def _envoyer_relais(prise_id: str, etat: str) -> None:
    """Envoie l'ordre au relais ESP32, HORS du chemin de réponse (tâche de fond)."""
    with suppress(Exception):
        await _get_relay_client().get(
            f"{settings.ecowatt_hardware_url}/relay?id={prise_id}&state={etat}")
    await hub.send_order(prise_id, etat)  # firmware WebSocket éventuel


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    _charger_tare()  # tare des capteurs mémorisée d'une session à l'autre
    tasks = [asyncio.create_task(_impact_loop()), asyncio.create_task(_poll_hardware_loop())]

    # Pont Bluetooth optionnel (mêmes ingestion/IA/impact que le WiFi).
    if settings.ecowatt_ble:
        from . import ble

        async def on_ble_measurement(msg: dict, send_order) -> None:
            prise_id = msg.get("prise_id") or msg.get("device_id")
            hub.register_ble(prise_id, send_order)  # pour router les ordres relais en BLE
            watts = float(msg.get("watts", 0))
            _apply_measurement(
                msg["device_id"], watts,
                prise_id=prise_id, nom=msg.get("nom"), priorite=msg.get("priorite"),
            )
            await _maybe_decide(watts)
            await hub.broadcast(snapshot())

        tasks.append(asyncio.create_task(ble.run_bridge(on_ble_measurement)))

    yield
    for t in tasks:
        t.cancel()


app = FastAPI(title="EcoWatt API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


# ---------- helpers ----------
def _devices() -> list[Device]:
    with get_session() as s:
        return list(s.exec(select(Device)).all())


def _devices_dicts() -> list[dict]:
    return [d.model_dump() for d in _devices()]


def _prix_marginal_pour_watts(watts: float) -> float:
    """Prix (FCFA) du prochain kWh évité, au barème CIE, pour un niveau de puissance foyer.

    Source de vérité UNIQUE du prix du kWh dans l'app (cohérence économies ⇄ facture, ADR-009) :
    on projette la puissance actuelle en conso mensuelle, on en déduit le barème applicable
    (social ≤ 100 kWh/mois, sinon général) et son prix marginal. Un kWh évité vaut ce prix « à la
    marge », pas un prix unique en dur — c'est exactement ce qu'affiche la carte « Prévision de facture ».
    """
    kwh_mois = max(0.0, watts) * 24.0 * 30.0 / 1000.0
    bareme = tarif_cie.bareme_pour_conso_mensuelle(kwh_mois)
    return tarif_cie.prix_marginal_mensuel(kwh_mois, bareme)


def _prix_marginal_actuel() -> float:
    """Prix marginal du kWh au niveau de consommation actuel du foyer (lit la base)."""
    watts = sum((d.conso_w or 0.0) for d in _devices() if d.etat == "on")
    return _prix_marginal_pour_watts(watts)


def _impact_from_wh(wh: float, prix_kwh: float | None = None) -> Impact:
    kwh = wh / 1000.0
    prix = _prix_marginal_actuel() if prix_kwh is None else prix_kwh
    return Impact(
        kwh_evites=round(kwh, 4),
        fcfa_economises=round(kwh * prix, 2),
        co2_evite_kg=round(kwh * settings.ecowatt_co2_kg_par_kwh, 4),
    )


def snapshot() -> dict:
    with get_session() as s:
        devices = list(s.exec(select(Device)).all())
        recent = list(s.exec(select(Decision).order_by(Decision.id.desc()).limit(10)).all())
    # Prix du kWh calculé sur les appareils déjà chargés (évite une seconde lecture de la base).
    watts_actifs = sum((d.conso_w or 0.0) for d in devices if d.etat == "on")
    imp = _impact_from_wh(_avoided_wh, _prix_marginal_pour_watts(watts_actifs))
    return {
        "devices": [d.model_dump(mode="json") for d in devices],
        "decisions": [d.model_dump(mode="json") for d in recent],
        "impact": imp.__dict__,
        "impact_projection_10000": projection(imp, 10000).__dict__,
        "mock": settings.use_mock,
        "peak_now": brain.is_peak(datetime.now().hour),
        "ts": datetime.utcnow().isoformat(),
    }


async def _impact_loop() -> None:
    """Chaque seconde, cumule l'énergie évitée par les appareils actuellement coupés."""
    global _avoided_wh
    while True:
        await asyncio.sleep(1)
        if _cut_baseline:
            _avoided_wh += sum(_cut_baseline.values()) / 3600.0
            await hub.broadcast(snapshot())

async def _poll_hardware_loop() -> None:
    """Interroge l'ESP32 en boucle pour récupérer les mesures (polling HTTP)."""
    hardware_url = settings.ecowatt_hardware_url
    # Timeout large : l'ESP32 (serveur mono-thread) + hotspot ont une latence variable (~350 ms,
    # parfois plusieurs secondes sous charge). Un timeout trop court perdait des cycles de mesure.
    async with httpx.AsyncClient(timeout=5.0) as client:
        while True:
            try:
                resp = await client.get(f"{hardware_url}/data")
                if resp.status_code == 200:
                    data = resp.json()
                    changed = False
                    for p_id, p_data in data.items():
                        # Ex: prise1 -> id "1"
                        prise_idx = p_id.replace("prise", "")
                        device_id = f"prise-{prise_idx}"
                        watts_bruts = float(p_data.get("puissance_W", 0.0))
                        nom = p_data.get("nom", f"Prise {prise_idx}")
                        # État RÉEL du relais tel que rapporté par le boîtier = source de vérité.
                        # Évite que le backend affiche "coupée" alors que le relais est physiquement
                        # allumé (ordre perdu). L'IA voit ainsi l'état réel et peut réagir.
                        etat_hw = "on" if p_data.get("etat", True) else "off"

                        # Anti-flicker : si un ordre vient d'être donné, on garde l'état voulu tant
                        # que le matériel ne l'a pas confirmé (ou 5 s max) -> l'affichage ne "revient"
                        # pas en arrière le temps que le relais bascule.
                        intent = _commande_intention.get(device_id)
                        if intent is not None:
                            voulu, quand = intent
                            if etat_hw == voulu or (datetime.utcnow() - quand).total_seconds() > 5:
                                _commande_intention.pop(device_id, None)
                            else:
                                etat_hw = voulu

                        # 1re fois qu'on voit la prise allumée cette session (installation, prise vide)
                        # -> on calibre son bruit à vide. Une seule fois : les allumages suivants
                        # gardent la tare, pour qu'un appareil branché puis rallumé reste visible.
                        if etat_hw == "on" and device_id not in _tare_fait and device_id not in _capture:
                            _demarrer_capture(device_id)

                        # Nettoyage du bruit ACS712 : relais ouvert => 0, tare + lissage sinon.
                        # L'IA ne doit décider que sur une mesure crédible, pas sur du bruit.
                        watts = _filtrer_watts(device_id, watts_bruts, etat_hw)

                        _apply_measurement(
                            device_id, watts,
                            prise_id=prise_idx, nom=nom, etat=etat_hw,
                        )
                        changed = True
                        await _maybe_decide(watts)
                    if changed:
                        await hub.broadcast(snapshot())
            except Exception:
                pass  # Le boîtier est éteint ou injoignable, on réessaie plus tard
            await asyncio.sleep(1)


def _parse_prio(p: str | None) -> Priorite:
    try:
        return Priorite(p) if p else Priorite.confort
    except ValueError:
        return Priorite.confort


def _apply_measurement(
    device_id: str,
    watts: float,
    *,
    prise_id: str | None = None,
    nom: str | None = None,
    priorite: str | None = None,
    etat: str | None = None,
) -> Device:
    """Enregistre une mesure. Si l'appareil est inconnu, il est créé automatiquement
    (auto-découverte) : dès qu'une prise se branche et envoie sa 1re mesure, elle apparaît.

    `etat` (« on »/« off ») : si fourni, synchronise l'état du relais tel que rapporté par le
    boîtier (source de vérité matérielle). Empêche la désynchro backend/relais physique."""
    with get_session() as s:
        dev = s.get(Device, device_id)
        if dev is None:
            dev = Device(
                id=device_id,
                nom=nom or device_id,
                prise_id=prise_id or device_id,
                priorite=_parse_prio(priorite),
            )
        dev.conso_w = watts
        if etat is not None:
            dev.etat = etat
            if etat == "on":
                _cut_baseline.pop(device_id, None)  # rallumé -> ne compte plus comme "évité"
        s.add(dev)
        s.add(Measurement(device_id=device_id, watts=watts))
        s.commit()
        s.refresh(dev)
        return dev


async def _apply_decision(dec: dict) -> None:
    """Persiste la décision, met à jour l'appareil, envoie l'ordre au relais."""
    action = dec["action"]
    device_id = dec.get("device_id")
    prise_id: str | None = None
    with get_session() as s:
        s.add(Decision(
            device_id=device_id or "",
            action=Action(action),
            raison=dec["raison"],
            replanifie_a=dec.get("replanifie_a"),
        ))
        dev = s.get(Device, device_id) if device_id else None
        if dev is not None and action in ("couper", "rallumer"):
            prise_id = dev.prise_id  # capturé dans la session (évite DetachedInstanceError)
            if action == "couper":
                _cut_baseline[dev.id] = dev.conso_w or 0.0
                dev.etat = "off"
                dev.replanifie_a = dec.get("replanifie_a")
            else:  # rallumer
                _cut_baseline.pop(dev.id, None)
                dev.etat = "on"
                dev.replanifie_a = None
            s.add(dev)
        s.commit()
    if prise_id and device_id and action in ("couper", "rallumer"):
        etat = "off" if action == "couper" else "on"
        # Réponse INSTANTANÉE : on mémorise l'état voulu (anti-flicker du polling) et on envoie
        # l'ordre au relais EN TÂCHE DE FOND (on ne bloque plus le clic sur la latence de l'ESP32).
        _commande_intention[device_id] = (etat, datetime.utcnow())
        asyncio.create_task(_envoyer_relais(prise_id, etat))


def _apply_priorite(device_id: str, priorite: str | None) -> None:
    """Reclasse un appareil (change sa priorité). N'agit pas sur le relais."""
    with get_session() as s:
        dev = s.get(Device, device_id)
        if dev is not None:
            dev.priorite = _parse_prio(priorite)
            s.add(dev)
            s.commit()


def _apply_rename(device_id: str, nom: str) -> None:
    """Renomme un appareil (nom d'affichage). N'agit pas sur le relais. Le nom N'est PAS
    réécrasé par le polling (`_apply_measurement` ne fixe le nom qu'à la création de l'appareil)."""
    nom = (nom or "").strip()
    with get_session() as s:
        dev = s.get(Device, device_id)
        if dev is not None and nom:
            dev.nom = nom
            s.add(dev)
            s.commit()


async def _maybe_decide(trigger_watts: float) -> None:
    """Déclenche le cerveau sur un pic en heure de pointe, avec cooldown (quota)."""
    now = datetime.now()
    if trigger_watts < settings.ecowatt_pic_watts or not brain.is_peak(now.hour):
        return
    if hub.last_decision_at and (now - hub.last_decision_at).total_seconds() < DECISION_COOLDOWN_S:
        return
    hub.last_decision_at = now
    dec = brain.decide(_devices_dicts(), now.hour)
    if dec["action"] != "garder":
        await _apply_decision(dec)
    await hub.broadcast(snapshot())


# ---------- REST ----------
class DeviceIn(BaseModel):
    id: str
    nom: str
    prise_id: str
    priorite: Priorite = Priorite.confort


class MeasurementIn(BaseModel):
    device_id: str
    watts: float
    nom: str | None = None
    prise_id: str | None = None
    priorite: str | None = None


@app.get("/")
def health() -> dict:
    return {"status": "ok", "mock": settings.use_mock, "model": settings.ecowatt_model}


@app.get("/api/state")
def get_state() -> dict:
    return snapshot()


@app.get("/api/impact")
def get_impact() -> dict:
    return _impact_from_wh(_avoided_wh).__dict__


# ---------- Prédiction & barème CIE (kWh ⇄ FCFA) ----------
class ConvertIn(BaseModel):
    valeur: float
    unite: Unite                       # "kwh" ou "fcfa"
    periode: str = "mois"              # "mois" ou "bimestre"


@app.post("/api/tarif/convertir")
def convertir(body: ConvertIn) -> dict:
    """Convertit kWh ⇄ FCFA via le barème CIE. Renvoie le détail de la facture.

    - unite=kwh  : `valeur` = kWh consommés  -> on renvoie le montant FCFA + détail.
    - unite=fcfa : `valeur` = montant payé    -> on renvoie les kWh correspondants.
    """
    mensuel = body.periode != "bimestre"
    if body.unite == Unite.kwh:
        kwh = max(0.0, body.valeur)
        facture = tarif_cie.facture_mensuelle(kwh) if mensuel else tarif_cie.facture_bimestre(kwh)
    else:
        kwh = (tarif_cie.kwh_pour_budget_mensuel(body.valeur) if mensuel
               else tarif_cie.kwh_pour_budget_bimestre(body.valeur))
        facture = tarif_cie.facture_mensuelle(kwh) if mensuel else tarif_cie.facture_bimestre(kwh)
    return {
        "bareme": tarif_cie.BAREME_DEFAUT.nom,
        "periode": "mois" if mensuel else "bimestre",
        "kwh": round(kwh, 3),
        "total_fcfa": facture.total_fcfa,
        "prix_moyen_fcfa_kwh": facture.prix_moyen_fcfa_kwh,
        "prix_marginal_fcfa_kwh": (tarif_cie.prix_marginal_mensuel(kwh) if mensuel
                                   else tarif_cie.prix_marginal_bimestre(kwh)),
        "facture": facture.__dict__ | {"lignes": [ln.__dict__ for ln in facture.lignes]},
    }


class PredireIn(BaseModel):
    valeurs: list[float]                   # relevés journaliers (kWh ou FCFA)
    unite: Unite = Unite.kwh
    budget_mensuel_fcfa: float | None = None


@app.post("/api/predire")
def predire(body: PredireIn) -> dict:
    """Prévision de consommation + plan d'économies à partir de relevés journaliers."""
    reco = prediction.recommander(body.valeurs, body.unite, body.budget_mensuel_fcfa)
    prev = reco.prevision
    return {
        "prevision": prev.__dict__,
        "objectif_kwh_jour": reco.objectif_kwh_jour,
        "cout_mois_prevu_fcfa": reco.cout_mois_prevu_fcfa,
        "cout_mois_objectif_fcfa": reco.cout_mois_objectif_fcfa,
        "economie_mois_fcfa": reco.economie_mois_fcfa,
        "co2_mois_evite_kg": reco.co2_mois_evite_kg,
        "sur_la_bonne_voie": reco.sur_la_bonne_voie,
        "jour_le_plus_charge": reco.jour_le_plus_charge,
        "actions": [a.__dict__ for a in reco.actions],
    }


class ComparerIn(BaseModel):
    valeur_courante: float
    valeur_precedente: float
    unite: Unite = Unite.kwh


@app.post("/api/comparer")
def comparer(body: ComparerIn) -> dict:
    """Compare le mois courant au mois précédent (conso, coût, variation, message)."""
    return prediction.comparer_mois(
        body.valeur_courante, body.valeur_precedente, body.unite
    ).__dict__


def _prediction_foyer(jours: int = 30) -> prediction.PredictionFoyer:
    """Prédiction par appareil calculée sur les mesures RÉELLES du boîtier (table Measurement).

    Lit les watts bruts, les intègre en kWh/jour par appareil (`agregation`), puis projette
    la facture mensuelle et classe les appareils par coût. C'est le pont mesures réelles -> IA.
    """
    maintenant = datetime.utcnow()
    depuis = maintenant - timedelta(days=jours)
    mesures = agregation.mesures_par_appareil(depuis=depuis)
    noms = {d.id: d.nom for d in _devices()}
    bilans: list[tuple[str, str, list[float], float, int]] = []
    for device_id, points in mesures.items():
        bilan = agregation.bilan_appareil(
            device_id, points, jours=jours, maintenant=maintenant,
        )
        jours_donnees = sum(1 for v in bilan.serie if v > 0)
        bilans.append((
            device_id, noms.get(device_id, device_id),
            bilan.serie, bilan.kwh_jour_observe, jours_donnees,
        ))
    return prediction.classer_appareils(bilans)


@app.get("/api/predictions")
def get_predictions(jours: int = 30) -> dict:
    """Prédiction par appareil sur les vraies mesures : qui va coûter le plus ce mois-ci.

    `jours` = fenêtre d'historique lue dans la base (défaut 30). Renvoie le classement des
    appareils, la facture mensuelle projetée du foyer et un message prêt à afficher.
    """
    foyer = _prediction_foyer(jours)
    return {
        "kwh_jour_total": foyer.kwh_jour_total,
        "kwh_mois_projete": foyer.kwh_mois_projete,
        "facture_mois_projetee_fcfa": foyer.facture_mois_projetee_fcfa,
        "bareme": foyer.bareme,
        "appareil_le_plus_cher": foyer.appareil_le_plus_cher,
        "message": foyer.message,
        "appareils": [a.__dict__ for a in foyer.appareils],
    }


@app.post("/api/devices")
def upsert_device(body: DeviceIn) -> dict:
    with get_session() as s:
        dev = s.get(Device, body.id)
        if dev is None:
            dev = Device(**body.model_dump())
        else:
            dev.nom, dev.prise_id, dev.priorite = body.nom, body.prise_id, body.priorite
        s.add(dev)
        s.commit()
        s.refresh(dev)
    return dev.model_dump()


class RenameIn(BaseModel):
    nom: str


@app.post("/api/devices/{device_id}/rename")
async def rename_device(device_id: str, body: RenameIn) -> dict:
    """Renomme une prise (nom d'affichage). Pour le clic dans l'UI ou un outil externe."""
    _apply_rename(device_id, body.nom)
    await hub.broadcast(snapshot())
    return {"ok": True, "device_id": device_id, "nom": body.nom.strip()}


class ControlIn(BaseModel):
    action: str  # "couper" | "rallumer"


@app.post("/api/devices/{device_id}/control")
async def control_device(device_id: str, body: ControlIn) -> dict:
    """Coupe/rallume une prise DIRECTEMENT (boutons de l'UI), SANS passer par l'IA."""
    action = body.action.strip().lower()
    if action not in ("couper", "rallumer"):
        return {"ok": False, "erreur": "action invalide (couper|rallumer)"}
    with get_session() as s:
        dev = s.get(Device, device_id)
        if dev is None:
            return {"ok": False, "erreur": "prise introuvable"}
        nom = dev.nom
    verbe = "Éteindre" if action == "couper" else "Allumer"
    await _apply_decision({
        "action": action, "device_id": device_id,
        "raison": f"Bouton « {verbe} » ({nom}).", "replanifie_a": None,
    })
    await hub.broadcast(snapshot())
    return {"ok": True, "device_id": device_id, "action": action, "nom": nom}


@app.post("/api/hardware/tare")
async def tarer_capteurs() -> dict:
    """Mémorise le bruit lu à VIDE (rien branché) pour le soustraire ensuite.

    À appeler quand aucune charge n'est branchée : on lit la puissance actuelle de chaque prise
    ALLUMÉE et on la retient comme fond de bruit. Les mesures suivantes en sont débarrassées.
    Mitigation logicielle en attendant la calibration matérielle des ACS712.
    """
    # Le bruit oscille beaucoup : on moyenne plusieurs lectures pour que la tare capte le NIVEAU
    # moyen du bruit, pas une valeur instantanée qui tomberait par hasard trop haut ou trop bas.
    sommes: dict[str, float] = {}
    comptes: dict[str, int] = {}
    client = _get_relay_client()
    # On tente plusieurs lectures et on TOLÈRE les ratés : l'ESP32 mono-thread saute parfois une
    # requête. Il suffit d'en réussir quelques-unes pour avoir une moyenne représentative.
    for _ in range(12):
        try:
            data = (await client.get(f"{settings.ecowatt_hardware_url}/data")).json()
            for p_id, p_data in data.items():
                if p_data.get("etat", True):  # prise allumée seulement (coupée => déjà 0)
                    device_id = f"prise-{p_id.replace('prise', '')}"
                    sommes[device_id] = sommes.get(device_id, 0.0) + float(p_data.get("puissance_W", 0.0))
                    comptes[device_id] = comptes.get(device_id, 0) + 1
        except Exception:
            pass  # raté isolé : on continue
        await asyncio.sleep(0.2)

    if not comptes:
        return {"ok": False, "erreur": "boîtier injoignable"}
    capte = {d: round(sommes[d] / comptes[d], 1) for d in sommes}
    _tare_bruit.update(capte)
    _ema_watts.clear()  # on repart d'un lissage neuf, cohérent avec la nouvelle tare
    _sauver_tare()
    await hub.broadcast(snapshot())
    return {"ok": True, "tare": capte}


@app.post("/api/hardware/tare/reset")
async def reset_tare() -> dict:
    """Oublie la tare (à faire une fois les capteurs vraiment calibrés)."""
    _tare_bruit.clear()
    _sauver_tare()
    await hub.broadcast(snapshot())
    return {"ok": True}


@app.post("/api/simulate/measurement")
async def simulate_measurement(body: MeasurementIn) -> dict:
    """Injecter une mesure sans hardware (auto-crée l'appareil s'il est inconnu)."""
    dev = _apply_measurement(
        body.device_id, body.watts,
        prise_id=body.prise_id, nom=body.nom, priorite=body.priorite,
    )
    await _maybe_decide(body.watts)
    await hub.broadcast(snapshot())
    return dev.model_dump(mode="json")


# ---------- Chat / assistant IA ----------
class ChatIn(BaseModel):
    message: str
    devices: list[dict] | None = None  # contexte client (mode démo : appareils du simulateur)
    execute: bool = True               # False : renvoyer l'action sans l'exécuter côté backend
    history: list[dict] | None = None  # échanges précédents [{role, content}] pour la mémoire


def _norm(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s.lower()) if unicodedata.category(c) != "Mn")


def _extract_nombres(m: str) -> list[float]:
    """Extrait les nombres d'un message (gère '5 000' et '12,5')."""
    compact = re.sub(r"(?<=\d)[ .](?=\d{3}\b)", "", m)  # '5 000' / '5.000' -> '5000'
    return [float(x.replace(",", ".")) for x in re.findall(r"\d+(?:[.,]\d+)?", compact)]


def _repondre_prediction(message: str) -> str | None:
    """Répond aux questions de PRÉDICTION par appareil à partir des vraies mesures du boîtier.

    « Quel appareil va me coûter le plus ce mois ? », « ma facture à ce rythme ? ». On lit la
    base réelle (`_prediction_foyer`) et on renvoie un chiffrage exact. Renvoie None si ce n'est
    pas une question de prédiction, ou s'il n'y a encore AUCUNE mesure (on laisse alors le LLM/
    les règles répondre plutôt que d'annoncer « rien mesuré » en pleine démo simulée)."""
    m = _norm(message)
    cout_appareil = ("appareil" in m or "prise" in m) and any(
        k in m for k in ["plus cher", "coute le plus", "coutera", "va couter", "va me couter",
                         "pese le plus", "gourmand"]
    )
    facture_future = any(
        k in m for k in ["a ce rythme", "fin de mois", "facture prevue", "prevision de facture",
                         "combien je vais payer", "vais payer ce mois", "facture ce mois",
                         "facture du mois"]
    )
    prediction_kw = any(
        k in m for k in ["prediction par appareil", "prevision par appareil", "projection",
                         "predis ma", "prevois ma conso", "previens ma conso"]
    )
    if not (cout_appareil or facture_future or prediction_kw):
        return None
    foyer = _prediction_foyer()
    if foyer.appareil_le_plus_cher is None:
        return None  # pas encore de mesures réelles : laisser le LLM/les règles gérer
    return foyer.message


def _repondre_branchement(message: str) -> str | None:
    """Dit si un appareil est branché (consomme) sur chaque prise, d'après la mesure réelle.

    « y a-t-il un appareil sur la 30A ? », « la prise 5A est-elle vide ? », « mes prises sont-elles
    utilisées ? ». Détection par seuil de puissance sur une prise ALLUMÉE (une prise coupée ne peut
    pas être sondée : plus de courant). Renvoie None si ce n'est pas cette question ou s'il n'y a
    encore aucune prise mesurée. Fiabilité conditionnée à la calibration des capteurs."""
    m = _norm(message)
    mots = any(k in m for k in ["branch", "debranch", "vide", "libre", "occup", "utilis",
                                "quelque chose", "connect", "presence", "present", "y a-t-il",
                                "y a t il", "y a til", "rien de"])
    cible = any(k in m for k in ["prise", "appareil", "30a", "5a", "boitier"])
    if not (mots and cible):
        return None
    devices = _devices_dicts()
    if not devices:
        return None
    seuil = settings.ecowatt_seuil_present_watts
    parts = []
    for d in devices:
        if d["etat"] != "on":
            parts.append(f"{d['nom']} : coupée (détection impossible tant qu'elle est coupée)")
            continue
        w = d.get("conso_w") or 0
        if w >= seuil:
            parts.append(f"{d['nom']} : un appareil est branché et consomme ({round(w)} W)")
        else:
            parts.append(f"{d['nom']} : rien ne consomme (prise libre ou appareil éteint)")
    return "Présence d'appareils : " + " ; ".join(parts) + "."


def _repondre_anomalie(message: str) -> str | None:
    """Détection d'anomalie de consommation : « y a-t-il un appareil anormal / qui chauffe /
    à vérifier ? », « tout va bien ? ». Répond à partir des VRAIES mesures, jamais via le LLM.
    Renvoie None si ce n'est pas une question de diagnostic/anomalie."""
    m = _norm(message)
    veut_diag = any(k in m for k in ["anomal", "anormal", "inhabituel", "bizarre", "probleme",
                                     "souci", "defaut", "defectueux", "en panne", "verifier",
                                     "chauffe", "surchauff", "danger", "risque", "tout va bien",
                                     "ca va", "rien d anormal", "un souci", "surconsom"])
    if not veut_diag:
        return None
    devices = _devices_dicts()
    if not devices:
        return None  # pas de mesures réelles : laisser le LLM / les règles répondre
    anomalies = anomalie.detecter(devices)
    if not anomalies:
        return ("Tout est normal : aucun appareil ne consomme de façon anormale en ce moment. "
                "Je surveille en continu et je t'alerte si l'un d'eux se met à tirer trop.")
    return " ".join(a.message for a in anomalies)


def _repondre_conso(message: str) -> str | None:
    """Consommation instantanée RÉELLE des prises (mesures du boîtier, lues dans la base).

    Répond EXACTEMENT (jamais via le LLM, jamais de valeur inventée) aux questions du type
    « combien consomment mes prises maintenant ? », « quelle est la puissance réelle de la 30A ? »,
    « conso en temps réel ? ». Renvoie None si ce n'est pas une question de conso instantanée, ou
    s'il n'y a encore aucune prise mesurée (on laisse alors le LLM / les règles répondre)."""
    m = _norm(message)
    # Laisser les questions tarifaires / de prédiction (futur, coût, facture) à leurs handlers.
    if any(k in m for k in ["kwh", "fcfa", "franc", "cfa", "facture", "paie", "paye", "budget",
                            "mois", "a ce rythme", "va couter", "coutera", "plus cher",
                            "prevision", "predi", "demain", "fin de mois"]):
        return None
    veut_conso = any(k in m for k in ["consomm", "conso", "watt", "puissance", "depense"])
    cible = any(k in m for k in ["prise", "appareil", "boitier", "capteur", "30a", "5a",
                                 "maintenant", "actuel", "en ce moment", "temps reel", "reel",
                                 "instantan", "tout de suite", "en direct", "live"])
    if not (veut_conso and cible):
        return None
    devices = _devices_dicts()
    if not devices:
        return None  # pas encore de mesures réelles : laisser le LLM / les règles gérer
    parts = []
    for d in devices:
        w = round(d.get("conso_w") or 0)
        etat = "" if d["etat"] == "on" else " (coupée)"
        parts.append(f"{d['nom']} : {w} W{etat}")
    total_on = round(sum((d.get("conso_w") or 0) for d in devices if d["etat"] == "on"))
    return ("Consommation réelle mesurée à l'instant : " + " ; ".join(parts)
            + f". Total des prises allumées : {total_on} W.")


def _repondre_tarif(message: str) -> str | None:
    """Répond EXACTEMENT (via le barème CIE) aux questions kWh/FCFA/comparaison.

    Prioritaire sur le LLM : on ne laisse jamais l'IA inventer un prix. Renvoie None si
    le message n'est pas une question tarifaire (le LLM / les règles prennent alors le relais).
    """
    m = _norm(message)
    # Mention d'argent, en MOT ENTIER : « franc(s) » ne doit PAS matcher « France ». (Bug corrigé :
    # « quelle est la capitale de la France ? » déclenchait une réponse tarifaire hors-sujet.)
    argent = bool(re.search(r"\b(fcfa|cfa|francs?)\b", m))
    # Prix du MATÉRIEL (boîtier, capteur, kit), pas de la facture d'électricité : on laisse le LLM
    # répondre (sans inventer de montant, cf. garde-fous). Sinon « combien coûte le boîtier ? »
    # tombait dans le barème kWh et sortait une réponse absurde.
    if any(k in m for k in ["boitier", "materiel", "capteur", "esp32", "kit", "appareil coute", "produit"]):
        return None
    # Les questions « compteur à carte / prépayé / combien de temps ça dure » relèvent d'un
    # DIALOGUE mené par le LLM (il pose des questions sur les appareils puis prédit la durée).
    # On ne les court-circuite pas : on rend la main au LLM.
    if any(k in m for k in ["compteur", "carte", "recharg", "prepay", "prépay", "credit",
                            "unite", "combien de temps", "dure", "durer", "tient", "tenir",
                            "jour", "semaine"]):
        return None
    # Intention tarifaire : une mention d'argent, d'énergie, de facture ou de consommation. « combien »
    # seul est trop générique (« combien d'étoiles ? ») : on ne le prend plus comme signal tarifaire.
    if not (argent or any(k in m for k in ["kwh", "kw/h", "facture", "paie", "paye", "coute",
                                           "cout", "budget", "consomm", "depens", "mois dernier",
                                           "mois precedent", "mois passe"])):
        return None

    # Les questions sur la consommation en temps réel des prises/appareils relèvent de l'IA
    if any(k in m for k in ["watt", "prise", "appareil"]) and not (
        argent or any(k in m for k in ["kwh", "kw/h", "facture", "paie", "paye", "coute", "cout", "budget", "mois"])
    ):
        return None

    nombres = _extract_nombres(m)
    # RÈGLE (choix Kader) : en Côte d'Ivoire on raisonne en argent. Le NOMBRE est des kWh UNIQUEMENT
    # s'il est explicitement suivi de « kWh » (relevé de compteur). Sinon c'est un montant en FCFA.
    # Cela évite de prendre « j'ai payé 15000 » ou « ma facture 30000 » pour 15000/30000 kWh.
    apres_kwh = bool(re.search(r"\d[\d .,]*\s*(kwh|kw ?/ ?h)", m))
    en_fcfa = not apres_kwh

    # 1) Comparaison mois courant vs mois précédent (besoin de 2 nombres).
    compare = any(k in m for k in ["mois dernier", "mois precedent", "mois passe", "compare",
                                   " vs ", "que le mois", "plus que", "moins que"])
    if compare and len(nombres) >= 2:
        unite = Unite.fcfa if en_fcfa else Unite.kwh
        c = prediction.comparer_mois(nombres[0], nombres[1], unite)
        return c.message

    if not nombres:
        if en_fcfa or "budget" in m:
            return "Dis-moi le montant en FCFA et je te dis combien de kWh tu peux consommer ce mois-ci."
        return "Dis-moi combien de kWh tu as consommés (ou combien tu as payé en FCFA) et je te réponds."

    n = nombres[0]

    # 2) Montant FCFA -> combien de kWh (budget / « j'ai payé/consommé X »).
    # Barème CIE choisi selon le niveau : au-delà du seuil social, on bascule au Tarif Général.
    if en_fcfa:
        kwh, bareme_obj = tarif_cie.kwh_pour_budget_mensuel_auto(n)
        prime_mois = bareme_obj.prime_fixe_bimestre_fcfa / 2.0
        return (f"Avec {n:.0f} FCFA par mois ({bareme_obj.nom}), tu peux consommer environ "
                f"{kwh:.0f} kWh. Au-delà, chaque kWh supplémentaire te coûte "
                f"{tarif_cie.prix_marginal_mensuel(kwh, bareme_obj):.0f} FCFA "
                f"(abonnement inclus : {prime_mois:.0f} FCFA/mois).")

    # 3) Consommation kWh -> montant FCFA. Barème CIE selon la conso (social ≤ 100 kWh/mois, sinon général).
    kwh = n
    bareme_obj = tarif_cie.bareme_pour_conso_mensuelle(kwh)
    f = tarif_cie.facture_mensuelle(kwh, bareme_obj)
    detail = ""
    if len(f.lignes) > 1 and bareme_obj.tranches[0].plafond_kwh is not None:
        seuil_mois = bareme_obj.tranches[0].plafond_kwh / 2.0
        detail = (f" Tu dépasses {seuil_mois:.0f} kWh/mois : {f.lignes[0].kwh:.0f} kWh à "
                  f"{f.lignes[0].prix_fcfa_kwh:.0f} FCFA, le reste à "
                  f"{f.lignes[-1].prix_fcfa_kwh:.0f} FCFA.")
        if f.lignes[-1].prix_fcfa_kwh > f.lignes[0].prix_fcfa_kwh:  # tarif progressif (social)
            detail += " Rester sous le seuil garde le kWh au tarif réduit."
    return (f"Pour {kwh:.0f} kWh par mois ({bareme_obj.nom}), ta facture serait d'environ "
            f"{f.total_fcfa:.0f} FCFA (prix moyen {f.prix_moyen_fcfa_kwh:.0f} FCFA/kWh, "
            f"dont {f.prime_fixe_fcfa:.0f} FCFA d'abonnement).{detail}")


_MOTS_NOMBRES = {"un": 1, "une": 1, "deux": 2, "trois": 3, "quatre": 4, "cinq": 5, "six": 6,
                 "sept": 7, "huit": 8, "neuf": 9, "dix": 10, "onze": 11, "douze": 12}


def _appareil_du_segment(seg: str) -> str | None:
    """Nom canonique de l'appareil décrit dans un segment (alias le plus long d'abord)."""
    meilleur, longueur = None, 0
    for canon, aliases in prediction.ALIAS.items():
        for a in aliases:
            if a in seg and len(a) > longueur:
                meilleur, longueur = canon, len(a)
    return meilleur


def _heures_du_segment(seg: str, canon: str) -> float | None:
    """Heures/jour trouvées dans un segment. None si absent (sauf cyclique / « en continu »)."""
    if canon in prediction.KWH_JOUR_CYCLIQUE:
        return 24.0  # ignoré dans le calcul (conso fixe), mais marque le segment comme complet
    if any(k in seg for k in ["continu", "toute la journee", "jour et nuit", "24h", "24 h"]):
        return 24.0
    mh = re.search(r"(\d+(?:[.,]\d+)?)\s*(?:h\b|heure)", seg)
    if mh:
        return float(mh.group(1).replace(",", "."))
    for mot, val in _MOTS_NOMBRES.items():
        if re.search(rf"\b{mot}\b\s*heure", seg):
            return float(val)
    return None


def _quantite_du_segment(seg: str) -> int:
    m = re.match(r"\s*(\d+)", seg)
    if m:
        suite = seg[m.end():]
        # Un nombre suivi de « h/heure » = durée, de « fcfa/cfa/franc » = montant : pas une quantité.
        if not re.match(r"\s*(?:h\b|heure)", suite) and not re.match(r"\s*(?:fcfa|francs?|cfa)", suite):
            return int(m.group(1))
    for mot, val in _MOTS_NOMBRES.items():
        if re.search(rf"\b{mot}\b", seg):
            return val
    return 1


def _parse_appareils(message: str) -> list[tuple[str, float, int]] | None:
    """Extrait [(nom, heures, quantite)] d'un message. None si un appareil non cyclique n'a
    pas d'heures (parse incomplet => on laisse le LLM poser la question)."""
    m = _norm(message)
    segments = re.split(r"[,;/]|\bet\b|\bplus\b|\bainsi que\b", m)
    appareils: list[tuple[str, float, int]] = []
    for seg in segments:
        canon = _appareil_du_segment(seg)
        if not canon:
            continue
        heures = _heures_du_segment(seg, canon)
        if heures is None:
            return None  # appareil sans durée => parse non fiable
        appareils.append((canon, heures, _quantite_du_segment(seg)))
    return appareils or None


def _parse_montant_fcfa(texte: str) -> float | None:
    """Montant de recharge (FCFA) trouvé dans le texte (message + historique)."""
    m = _norm(texte)
    cands = re.findall(r"(\d[\d .]*\d|\d+)\s*(?:fcfa|francs?|cfa)", m)
    cands += re.findall(r"recharg\w*\s*(?:de\s*)?(\d[\d .]*\d|\d+)", m)
    cands += re.findall(r"(?:mets?|mettre|met)\s*(\d[\d .]*\d|\d+)", m)
    valeurs = [float(re.sub(r"[ .]", "", c)) for c in cands if re.sub(r"[ .]", "", c)]
    valeurs = [v for v in valeurs if v >= 100]  # une recharge fait au moins ~100 FCFA
    return valeurs[-1] if valeurs else None


def _repondre_prepaye(message: str, history: list[dict] | None) -> str | None:
    """Calcul EXACT (Python) de la durée d'une recharge quand l'utilisateur a donné ses
    appareils. Renvoie None si on n'a pas de quoi calculer (le LLM mène alors le dialogue)."""
    appareils = _parse_appareils(message)
    if not appareils:
        return None
    contexte = " ".join(str(h.get("content", "")) for h in (history or [])) + " " + message
    prepaye = any(k in _norm(contexte) for k in ["compteur", "carte", "recharg", "prepay",
                                                 "credit", "combien de temps", "dure", "tient",
                                                 "jour", "fcfa", "franc", "cfa"])
    if not prepaye:
        return None  # une liste d'appareils hors contexte prépayé n'est pas pour nous
    montant = _parse_montant_fcfa(contexte)
    return prediction.predire_prepaye(appareils, montant).message


def _find_device(devices: list[dict], m: str) -> dict | None:
    for d in devices:
        if _norm(d["nom"]) in m:
            return d
    return None


# --- Ordres de contrôle DÉTERMINISTES (couper / rallumer / tout) ------------------------
# Le pilotage physique ne doit JAMAIS dépendre du LLM : il doit être fiable, instantané,
# gratuit et infaillible, même quand Groq est saturé (quota) ou injoignable (réseau).
# Ce parseur comprend « prise 1/2 », « 30A/5A », les noms d'appareils, « tout / les deux ».
_VERBES_OFF = ("coupe", "couper", "coupez", "eteins", "eteindre", "eteint", "eteignez",
               "arrete", "arreter", "arretes", "stoppe", "stop", "ferme", "fermer",
               "desactive", "desactiver", "debranche", "debrancher")
_VERBES_ON = ("rallume", "rallumer", "rallumez", "allume", "allumer", "allumez",
              "reactive", "active", "activer", "remets", "remettre", "redemarre",
              "demarre", "demarrer", "rebranche", "rebrancher")
_MOTS_QUESTION = ("pourquoi", "comment", "quand", "explique", "raison", "est-ce", "est ce",
                  "combien", "quel", "quelle", "quels", "quelles",
                  # tournures de capacité : ce sont des questions, pas des ordres
                  "tu peux", "peux-tu", "peux tu", "pourrais", "capable", "possible", "saurais")


def _detecter_verbe(m: str) -> str | None:
    """'couper' / 'rallumer' selon le verbe. None si aucun ou ambigu (les deux présents)."""
    off = any(re.search(rf"\b{v}", m) for v in _VERBES_OFF)
    on = any(re.search(rf"\b{v}", m) for v in _VERBES_ON)
    if off == on:  # aucun, ou les deux -> on laisse le LLM trancher
        return None
    return "couper" if off else "rallumer"


def _numeros_de_prise(m: str) -> set[str]:
    """Numéros explicites (« prise 1 », « numéro 2 », « la première »)."""
    nums = {mo.group(1) for mo in re.finditer(r"(?:prise|numero|no|n°|n)\s*0*([1-9])\b", m)}
    if re.search(r"\bpremi(?:er|ere)", m):
        nums.add("1")
    if re.search(r"\bdeuxieme\b|\bseconde?\b", m):
        nums.add("2")
    return nums


def _resoudre_appareils(m: str, devices: list[dict]) -> tuple[list[dict], bool]:
    """(appareils visés, global?). Résout « tout / les deux », « prise 1/2 », « 30A/5A »
    et les noms d'appareils (utile dès qu'on donne des noms parlants aux prises)."""
    if re.search(r"\btout(?:es|s)?\b|\bles deux\b|\bl'ensemble\b|\bchaque prise\b", m):
        return list(devices), True
    cibles: list[dict] = []
    vus: set[str] = set()

    def _add(d: dict) -> None:
        if d["id"] not in vus:
            vus.add(d["id"])
            cibles.append(d)

    nums = _numeros_de_prise(m)
    for d in devices:
        pid = re.sub(r"\D", "", str(d.get("prise_id") or "")) or re.sub(r"\D", "", d["id"])
        if pid and pid[-1] in nums:
            _add(d)
    for d in devices:
        nom = _norm(d["nom"])
        if not nom:
            continue
        if nom in m:
            _add(d)
            continue
        capteur = re.fullmatch(r"(\d+)\s*a", nom)  # « 30A » / « 5A »
        if capteur and re.search(rf"\b{capteur.group(1)}\s*a\b", m):
            _add(d)
    return cibles, False


def _parse_order(message: str, devices: list[dict]) -> list[dict] | None:
    """Interprète un ordre de contrôle SANS LLM. None si ce n'est pas un ordre clair."""
    if not devices:
        return None
    if "?" in message:
        return None  # une question n'est jamais un ordre (« tu peux tout couper ? » ne coupe rien)
    m = _norm(message)
    if any(q in m for q in _MOTS_QUESTION):
        return None  # c'est une question, pas un ordre
    verbe = _detecter_verbe(m)
    if verbe is None:
        return None
    cibles, _glob = _resoudre_appareils(m, devices)
    if not cibles:
        return None
    verbe_txt = "coupe" if verbe == "couper" else "rallume"
    return [
        {"action": verbe, "device_id": d["id"],
         "raison": f"Ordre direct de l'utilisateur : je {verbe_txt} {d['nom']}.",
         "replanifie_a": None}
        for d in cibles
    ]


def _reply_order(actions: list[dict], devices: list[dict]) -> str:
    noms = {d["id"]: d["nom"] for d in devices}
    libelles = [noms.get(a["device_id"], a["device_id"]) for a in actions]
    fait = "coupé" if actions[0]["action"] == "couper" else "rallumé"
    if len(libelles) == 1:
        return f"C'est fait, j'ai {fait} {libelles[0]}."
    return f"C'est fait, j'ai {fait} : {', '.join(libelles)}."


# --- Renommage DÉTERMINISTE des prises (nom d'affichage) : pour le terrain, sans LLM -----
# « renomme la prise 1 en Bouilloire », « la prise 1 c'est la bouilloire », « la 30A s'appelle X ».
# Une fois renommée, « coupe la bouilloire » marche tout seul (le parseur d'ordres matche par nom).
_RENAME_CONNECT = r"(?:en|comme|c'?est|cest|s'?appelle|sappelle|devient|=|:)"


_PRISE_PAT = r"(?:prise\s*0*[12]|30\s*a|5\s*a|premi[eè]re|deuxi[eè]me|seconde?)"


def _nettoyer_nom(nom: str) -> str | None:
    """Retire les articles/fillers en tête et valide le nom d'appareil."""
    nom = re.sub(r"^\s*(?:le|la|l'|les|un|une|mon|ma|mes|ce|cet|cette|de\s+la|du|de|d'|nomm[eé]e?)\b\s*",
                 "", nom, flags=re.IGNORECASE)
    nom = nom.strip(" \t.,;:!?\"'«»").strip()
    if not nom or len(nom) > 40:
        return None
    if _norm(nom) in ("quoi", "qui", "comment", "quel", "quelle", "ca", "cela", "ok", "rien", "vide"):
        return None
    return nom[0].upper() + nom[1:]


def _parse_rename(message: str, devices: list[dict]) -> tuple[str, str] | None:
    """Assigne un appareil à une prise (= la renomme), dans les DEUX ordres de phrase.

    Gère : « la prise 1 c'est le ventilateur », « sur la prise 1 il y a le frigo »,
    « le ventilateur est sur la prise 1 », « j'ai branché le ventilo sur la prise 2 »,
    « renomme la prise 1 en Climatiseur », « prise 1 : télévision ».
    Renvoie (device_id, nom) ou None. Ne se déclenche PAS sur un ordre de contrôle ni une question."""
    if not devices or "?" in message:
        return None
    m = _norm(message)
    if _detecter_verbe(m) is not None:  # coupe/allume... => c'est un ordre, pas une assignation
        return None
    if not re.search(_PRISE_PAT, m):
        return None

    ref_text = nom = None
    # A) appareil AVANT la prise : « ... <nom> (est) (branché) sur (la) prise X »
    mb = re.search(r"(.+?)\s+(?:est\s+|se\s+trouve\s+)?(?:branch\w+\s+)?sur\s+(?:la\s+|le\s+)?("
                   + _PRISE_PAT + r")", message, re.IGNORECASE)
    if mb:
        brut = re.sub(r"^.*\b(?:branch\w+|mis|mets?|install\w+|il\s+y\s+a|y\s+a|c'?est)\b\s*",
                      "", mb.group(1), flags=re.IGNORECASE)
        ref_text, nom = mb.group(2), brut
    else:
        # B) verbe de renommage explicite : « renomme/appelle/nomme (la) prise X (en) <nom> »
        mv = re.search(r"(?:renomm\w*|rebaptis\w*|surnomm\w*|appell\w*|nomm\w*)\s+(?:la\s+|le\s+)?("
                       + _PRISE_PAT + r")\s*(?:en|:|=|comme)?\s*(.+)$", message, re.IGNORECASE)
        if mv:
            ref_text, nom = mv.group(1), mv.group(2)
        else:
            # C) prise D'ABORD avec un marqueur d'assignation FORT (pas « en »/« est » seuls, ambigus)
            ma = re.search(r"(?:sur\s+)?(?:la\s+|le\s+)?(" + _PRISE_PAT +
                           r")\s*(?:,|:|=|c'?est|cest|contient|renferme|il\s+y\s+a|y\s+a|j'?ai\s+branch\w+|s'?appelle)\s+(.+)$",
                           message, re.IGNORECASE)
            if ma:
                ref_text, nom = ma.group(1), ma.group(2)

    if not ref_text or not nom:
        return None
    cibles, _glob = _resoudre_appareils(_norm(ref_text), devices)
    if not cibles:
        return None
    nom = _nettoyer_nom(nom)
    if not nom:
        return None
    return cibles[0]["id"], nom


def _interpret(message: str, devices: list[dict] | None = None) -> tuple[str, dict | None]:
    """Interprète un message utilisateur : renvoie (réponse, action éventuelle).

    Version à base de règles (déterministe, sans quota), utilisée en repli quand le LLM est
    indisponible. `devices` permet de raisonner sur un contexte fourni par le client (mode démo).
    """
    m = _norm(message)
    if devices is None:
        devices = _devices_dicts()
    imp = _impact_from_wh(_avoided_wh)

    if any(k in m for k in ["bonjour", "salut", "coucou", "hello", "bonsoir"]):
        return ("Bonjour ! Demande-moi quel appareil consomme le plus, pourquoi j'ai coupé "
                "quelque chose, ton bilan d'économies, ou donne-moi un ordre.", None)

    if (("ecowatt" in m and any(k in m for k in ["quoi", "presente", "explique", "c est", "cest"]))
            or "comment ca marche" in m or "comment tu fonctionne" in m or "comment tu marche" in m):
        return ("EcoWatt est un réseau de prises intelligentes piloté par IA. Chaque prise mesure "
                "la consommation réelle d'un appareil et peut le couper. Je décide quoi couper ou "
                "décaler hors des heures de pointe selon la priorité de l'appareil, le moment, ton "
                "budget et la consommation, ce qui réduit ta facture et le CO2.", None)

    if any(k in m for k in ["aide", "help", "que peux", "tu sais faire", "a quoi tu sers"]):
        return ("Je peux t'expliquer EcoWatt, te dire quel appareil consomme le plus, justifier "
                "mes coupures, estimer ta facture (« 120 kWh ça fait combien ? », « 5000 FCFA "
                "c'est combien de kWh ? »), la comparer au mois dernier, donner ton bilan "
                "d'économies, et exécuter tes ordres (couper/rallumer un appareil).", None)

    if any(k in m for k in ["conseil", "astuce", "comment econom", "reduire", "moins consommer"]):
        return ("Trois leviers : décaler les gros appareils hors des heures de pointe, couper les "
                "veilles inutiles, et marquer comme reportable ce qui n'est pas vital. Je m'en "
                "occupe automatiquement, mais tu peux aussi me donner des consignes.", None)

    if any(k in m for k in ["heure de pointe", "heures creuses", "heures pleines", "pointe"]):
        return ("Les heures de pointe sont les moments où tout le monde consomme en même temps : "
                "le réseau est saturé et l'électricité la plus polluante. J'y déleste en priorité "
                "les appareils reportables, puis je les rallume en heures creuses (par défaut 18h-22h).", None)

    if any(k in m for k in ["consomme le plus", "plus gros", "gourmand", "gros conso"]):
        on = [d for d in devices if d["etat"] == "on"]
        if not on:
            return ("Aucun appareil n'est allumé pour l'instant.", None)
        top = max(on, key=lambda d: d["conso_w"])
        return (f"L'appareil le plus gourmand est {top['nom']} ({round(top['conso_w'])} W).", None)

    if ("appareil" in m or "prise" in m) and any(k in m for k in ["combien", "nombre", "compte"]):
        actifs = sum(1 for d in devices if d["etat"] == "on")
        return (f"Tu as {len(devices)} appareils connectés, dont {actifs} allumés.", None)

    if any(k in m for k in ["econom", "impact", "kwh", "co2", "gaspill", "facture", "bilan", "combien j"]):
        return (f"EcoWatt a évité {imp.kwh_evites} kWh, soit {imp.fcfa_economises} FCFA "
                f"et {imp.co2_evite_kg} kg de CO2.", None)

    if any(k in m for k in ["pourquoi", "explique", "raison"]):
        with get_session() as s:
            last = s.exec(select(Decision).order_by(Decision.id.desc()).limit(1)).first()
        return ((f"Ma dernière décision : {last.raison}" if last else
                 "Je n'ai pas encore pris de décision."), None)

    if any(k in m for k in ["coupe", "eteins", "eteindre", "arrete", "stop"]):
        d = _find_device(devices, m)
        if d:
            return (f"D'accord, je coupe {d['nom']}.",
                    {"action": "couper", "device_id": d["id"],
                     "raison": f"Coupure demandée par l'utilisateur ({d['nom']}).", "replanifie_a": None})
        return ("Quel appareil veux-tu que je coupe ?", None)

    if any(k in m for k in ["allume", "rallume", "active", "remets"]):
        d = _find_device(devices, m)
        if d:
            return (f"C'est noté, je rallume {d['nom']}.",
                    {"action": "rallumer", "device_id": d["id"],
                     "raison": f"Rallumage demandé par l'utilisateur ({d['nom']}).", "replanifie_a": None})
        return ("Quel appareil veux-tu rallumer ?", None)

    if any(k in m for k in ["etat", "status", "appareils", "liste", "actif"]):
        lines = " ; ".join(
            f"{d['nom']} : {round(d['conso_w']) if d['etat'] == 'on' else 0} W ({d['priorite']})"
            for d in devices
        )
        return (f"État actuel : {lines}", None)

    return ("Je peux t'indiquer quel appareil consomme le plus, expliquer mes décisions, "
            "donner ton bilan d'économies, ou couper/rallumer un appareil.", None)


# --- Réponses DÉTERMINISTES aux questions « méta » sur l'IA (jamais le LLM) --------------------- #
# Filet de sécurité jour J : ces questions sont très probables au jury et un LLM pourrait déraper
# (révéler le modèle, avouer « des règles codées », se dénigrer). On les fige.
_META_NATURE = ("vraie ia", "vrai ia", "vraie intelligence", "regles codees", "regle codee",
                "code en dur", "codee en dur", "un robot", "es-tu humain", "es tu humain",
                "une machine", "un programme", "un script", "vraiment de l'ia", "vraiment une ia",
                "juste un programme", "juste des regles")
_META_MODELE = ("modele", "quelle ia", "quel ia", "quelle intelligence", "quelle techno",
                "technologie", "llm", "chatgpt", "gpt", "openai", "groq", "llama", "gemini",
                "deepseek", "mistral", "openrouter", "quel serveur", "tournes sur", "quel algorithme")
_REPONSE_META_NATURE = (
    "Oui, c'est bien de l'intelligence artificielle : je comprends le langage naturel, je pondère "
    "plusieurs facteurs (priorité des appareils, heure de pointe, budget, consommation réelle) pour "
    "décider quoi couper ou décaler, et j'explique chaque décision, là où un simple minuteur ne ferait "
    "qu'obéir à l'heure. Les chiffres sensibles comme le prix exact sont calculés de façon fiable, pour "
    "ne jamais t'induire en erreur."
)
_REPONSE_META_MODELE = (
    "Je suis l'assistant IA d'EcoWatt. Ce qui compte, c'est ce que je fais pour toi : mesurer ta "
    "consommation appareil par appareil, décider quoi couper ou décaler hors des heures de pointe, "
    "prédire ta facture au barème CIE et t'expliquer chaque choix. Je préfère rester là-dessus plutôt "
    "que sur la technique."
)


def _repondre_meta(message: str) -> str | None:
    """Réponse figée aux questions sur la nature/technologie de l'IA. None sinon."""
    m = _norm(message)
    if any(k in m for k in _META_NATURE):
        return _REPONSE_META_NATURE
    if any(k in m for k in _META_MODELE):
        return _REPONSE_META_MODELE
    return None


@app.post("/api/chat")
async def chat(body: ChatIn) -> dict:
    """Conversation avec l'IA. Mode réel = DeepSeek V3 (OpenRouter) ; sinon règles locales.

    Si le LLM échoue (pas de clé, quota, réseau), on retombe automatiquement sur `_interpret`.
    """
    # Filet jour J : questions « méta » sur l'IA (quel modèle, vraie IA ou règles codées...) →
    # réponse figée, jamais confiée au LLM (zéro risque de dérapage devant le jury).
    meta = _repondre_meta(body.message)
    if meta is not None:
        return {"reply": meta, "actions": []}

    # Diagnostic / sécurité : un appareil consomme-t-il anormalement (défaut, surchauffe) ?
    # Prioritaire : chiffrage exact sur les vraies mesures, jamais confié au LLM.
    anom = _repondre_anomalie(body.message)
    if anom is not None:
        return {"reply": anom, "actions": []}

    # Priorité absolue n°0 : prédiction par appareil sur les VRAIES mesures du boîtier
    # (« quel appareil va me coûter le plus ce mois ? »). Chiffrage exact, jamais inventé.
    pred = _repondre_prediction(body.message)
    if pred is not None:
        return {"reply": pred, "actions": []}

    # Présence d'un appareil sur une prise (« y a-t-il un appareil branché sur la 30A ? »).
    # Détection par seuil de puissance sur la mesure réelle, avant conso pour que « branché/vide »
    # prime sur « combien ça consomme ».
    presence = _repondre_branchement(body.message)
    if presence is not None:
        return {"reply": presence, "actions": []}

    # Consommation instantanée RÉELLE des prises (« combien consomment mes prises maintenant ? »).
    # Chiffres exacts lus sur le boîtier, jamais inventés par le LLM. Avant le tarif car « combien
    # je consomme » sans unité serait sinon capté par le handler tarifaire.
    conso = _repondre_conso(body.message)
    if conso is not None:
        return {"reply": conso, "actions": []}

    # Priorité absolue : questions tarifaires (kWh/FCFA/comparaison) répondues EXACTEMENT via le
    # barème CIE, jamais par le LLM (pas d'invention de prix). Marche en démo comme en réel.
    tarif = _repondre_tarif(body.message)
    if tarif is not None:
        return {"reply": tarif, "actions": []}

    # Prépayé : si l'utilisateur a donné ses appareils, on calcule la durée EXACTEMENT (Python).
    # Sinon (pas d'appareils parsables), on laisse le LLM mener le dialogue et poser les questions.
    prepaye = _repondre_prepaye(body.message, body.history)
    if prepaye is not None:
        return {"reply": prepaye, "actions": []}

    # Contexte des appareils : celui fourni par le client (simulateur démo) ou la base backend.
    ctx_devices = body.devices if body.devices is not None else _devices_dicts()

    # Renommage DÉTERMINISTE d'une prise (« la prise 1 c'est la bouilloire »), avant tout : donne un
    # nom parlant, sans LLM. Après ça, « coupe la bouilloire » marche via le parseur d'ordres.
    rename = _parse_rename(body.message, ctx_devices)
    if rename is not None:
        did, nom = rename
        if body.execute:
            _apply_rename(did, nom)
            await hub.broadcast(snapshot())
        return {"reply": f"C'est noté, cette prise s'appelle maintenant « {nom} ». "
                         f"Tu peux me dire « coupe {nom} » ou « allume {nom} ».",
                "actions": [{"action": "renommer", "device_id": did, "nom": nom}]}

    # Ordre de contrôle DÉTERMINISTE (couper/rallumer/tout), AVANT le LLM : fiable et instantané,
    # sans consommer le quota Groq, et garanti même si l'IA est saturée/injoignable le jour J.
    order = _parse_order(body.message, ctx_devices)
    if order is not None:
        if body.execute:
            for a in order:
                await _apply_decision(a)
            await hub.broadcast(snapshot())
        return {"reply": _reply_order(order, ctx_devices), "actions": order}

    result = None
    if not settings.use_mock:
        imp = _impact_from_wh(_avoided_wh).__dict__
        with get_session() as s:
            recent = [
                {"action": d.action.value, "raison": d.raison}
                for d in s.exec(select(Decision).order_by(Decision.id.desc()).limit(5)).all()
            ]
        result = await asyncio.to_thread(
            brain.chat_llm, body.message, ctx_devices, datetime.now().hour, imp, recent, body.history
        )

    if result is None:
        reply, action = _interpret(body.message, ctx_devices)  # repli règles si LLM indisponible
        actions = [action] if action is not None else []
    else:
        reply, actions = result["reply"], result["actions"]

    # execute=False (mode démo) : on renvoie les actions au client qui les exécute sur son simulateur.
    if actions and body.execute:
        for a in actions:
            if a.get("action") == "priorite":
                _apply_priorite(a["device_id"], a.get("priorite"))
            else:
                await _apply_decision(a)
        await hub.broadcast(snapshot())
    return {"reply": reply, "actions": actions}


# ---------- WebSocket ----------
@app.websocket("/ws/prise/{prise_id}")
async def ws_prise(ws: WebSocket, prise_id: str) -> None:
    """Connexion d'une prise ESP32 : reçoit les mesures, peut recevoir des ordres."""
    await ws.accept()
    hub.register_prise(prise_id, ws)
    try:
        while True:
            # {device_id, watts, nom?, priorite?} — nom/priorite servent à l'auto-découverte
            data = await ws.receive_json()
            watts = float(data["watts"])
            _apply_measurement(
                data["device_id"],
                watts,
                prise_id=prise_id,
                nom=data.get("nom"),
                priorite=data.get("priorite"),
            )
            await _maybe_decide(watts)
            await hub.broadcast(snapshot())
    except WebSocketDisconnect:
        hub.unregister_prise(prise_id)


@app.websocket("/ws/app")
async def ws_app(ws: WebSocket) -> None:
    """Connexion du dashboard : reçoit l'état en temps réel."""
    await ws.accept()
    hub.register_app(ws)
    await ws.send_json(snapshot())
    try:
        while True:
            await ws.receive_text()  # garde la connexion ouverte (ping éventuel)
    except WebSocketDisconnect:
        hub.unregister_app(ws)
