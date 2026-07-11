"""Pont Bluetooth (BLE) optionnel : relie un boîtier ESP32 au backend via Bluetooth au lieu
du WiFi. Le reste (ingestion, IA, impact, dashboard) est identique.

⚠️ Nécessite un adaptateur Bluetooth sur le PC et la lib `bleak` (pip install bleak).
Non testé sans matériel BT. Activé seulement si ECOWATT_BLE=1.

Protocole (mêmes UUID côté firmware) :
- Service           : settings.ble_service_uuid
- Mesures (notify)  : settings.ble_measure_uuid  -> le boîtier pousse {device_id, watts, nom, priorite}
- Commande (write)  : settings.ble_command_uuid  -> le backend écrit {prise_id, relais: on|off}

`bleak` est importé DANS les fonctions pour ne pas casser le backend si la lib est absente.
"""
from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable

from .config import settings

# on_measurement(msg: dict, send_order: Callable[[str, str], Awaitable]) -> Awaitable
OnMeasurement = Callable[[dict, Callable[[str, str], Awaitable]], Awaitable]


async def run_bridge(on_measurement: OnMeasurement) -> None:
    """Scanne en boucle les boîtiers EcoWatt BLE et se connecte à chacun."""
    from bleak import BleakScanner  # import tardif (optionnel)

    connected: set[str] = set()
    while True:
        try:
            devices = await BleakScanner.discover(timeout=5.0)
            for d in devices:
                name = d.name or ""
                if name.startswith(settings.ble_name_prefix) and d.address not in connected:
                    connected.add(d.address)
                    asyncio.create_task(_handle(d, on_measurement, connected))
        except Exception:
            pass  # pas d'adaptateur / erreur de scan : on réessaie
        await asyncio.sleep(10)


async def _handle(device, on_measurement: OnMeasurement, connected: set[str]) -> None:
    from bleak import BleakClient

    try:
        async with BleakClient(device) as client:

            async def send_order(prise_id: str, relais: str) -> None:
                payload = json.dumps({"prise_id": prise_id, "relais": relais}).encode()
                await client.write_gatt_char(settings.ble_command_uuid, payload)

            def on_notify(_char, data: bytearray) -> None:
                try:
                    msg = json.loads(bytes(data).decode())
                except Exception:
                    return
                asyncio.create_task(on_measurement(msg, send_order))

            await client.start_notify(settings.ble_measure_uuid, on_notify)
            while client.is_connected:
                await asyncio.sleep(1)
    except Exception:
        pass
    finally:
        connected.discard(device.address)
