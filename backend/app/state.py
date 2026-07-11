"""État live en mémoire + registres de connexions WebSocket (ADR-002).

- prises : une connexion WebSocket par prise_id (pour pousser les ordres de relais).
- app    : ensemble de connexions du dashboard (pour diffuser l'état en temps réel).
Le stockage durable est dans SQLite (voir db.py / models.py) ; ici on garde le live.
"""
from __future__ import annotations

import asyncio
import json
from datetime import datetime

from fastapi import WebSocket


class Hub:
    def __init__(self) -> None:
        self.prises: dict[str, WebSocket] = {}   # prises reliées en WiFi (WebSocket)
        self.ble: dict[str, object] = {}         # prises reliées en Bluetooth (fonction d'envoi)
        self.apps: set[WebSocket] = set()
        # cooldown anti-spam du cerveau IA (quota gratuit limité, ADR-005)
        self.last_decision_at: datetime | None = None

    # --- prises WiFi ---
    def register_prise(self, prise_id: str, ws: WebSocket) -> None:
        self.prises[prise_id] = ws

    def unregister_prise(self, prise_id: str) -> None:
        self.prises.pop(prise_id, None)

    # --- prises Bluetooth (BLE) ---
    def register_ble(self, prise_id: str, sender) -> None:
        self.ble[prise_id] = sender

    def unregister_ble(self, prise_id: str) -> None:
        self.ble.pop(prise_id, None)

    async def send_order(self, prise_id: str, relais: str) -> bool:
        """Envoie un ordre de relais à la prise, par WiFi si dispo, sinon par Bluetooth."""
        ws = self.prises.get(prise_id)
        if ws is not None:
            await ws.send_text(json.dumps({"prise_id": prise_id, "relais": relais}))
            return True
        sender = self.ble.get(prise_id)
        if sender is not None:
            await sender(prise_id, relais)  # fonction fournie par le pont BLE
            return True
        return False

    # --- app ---
    def register_app(self, ws: WebSocket) -> None:
        self.apps.add(ws)

    def unregister_app(self, ws: WebSocket) -> None:
        self.apps.discard(ws)

    async def broadcast(self, payload: dict) -> None:
        """Diffuse l'état à tous les dashboards, EN PARALLÈLE, avec un timeout court par
        connexion. Une connexion zombie (onglet fermé/reconnecté) est purgée au lieu de bloquer
        tout le serveur plusieurs secondes (sinon les boutons/ordres deviennent très lents)."""
        if not self.apps:
            return
        text = json.dumps(payload, ensure_ascii=False, default=str)

        async def _send(ws: WebSocket) -> WebSocket | None:
            try:
                await asyncio.wait_for(ws.send_text(text), timeout=0.6)
                return None
            except Exception:
                return ws  # morte ou trop lente -> à purger

        results = await asyncio.gather(*(_send(ws) for ws in list(self.apps)))
        for ws in results:
            if ws is not None:
                self.apps.discard(ws)


hub = Hub()
