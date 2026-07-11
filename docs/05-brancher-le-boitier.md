# 05 - Brancher le boîtier (ESP32) au logiciel

> Comment relier une prise intelligente ESP32 au backend EcoWatt, de bout en bout.

## Vue d'ensemble

```
[Boîtier ESP32]  --WiFi-->  [PC : backend FastAPI :8000]  --WebSocket-->  [Dashboard (mode réel)]
   mesure + relais            enregistre, décide (IA), diffuse
```

Le boîtier et le PC doivent être sur le **même réseau WiFi**. Le boîtier ouvre une connexion
WebSocket vers l'IP du PC. Dès sa 1re mesure, l'appareil apparaît tout seul sur le dashboard
(auto-découverte).

---

## 1. Matériel et câblage (par prise)

- **ESP32** (le cerveau du boîtier).
- **Capteur de courant** (ex. SCT-013 non invasif + circuit de mesure, ou module de mesure de
  puissance) : mesure la consommation de l'appareil.
- **Module relais** conçu pour le secteur : coupe/rallume l'appareil.

Branchements logiques (voir `firmware/src/main.cpp`) : relais sur la broche `PIN_RELAY` (26),
capteur sur `PIN_SENSOR` (34).

⚠️ **Sécurité 220V** : l'ESP32 est alimenté isolé du secteur, le relais est un module secteur,
jamais de fil nu sous tension, montage supervisé par quelqu'un qui s'y connaît.

---

## 2. Prérequis réseau (côté PC)

1. **Même WiFi** : le PC et l'ESP32 sur le même réseau (box maison ou partage de connexion).
2. **IP locale du PC** : actuellement **192.168.1.19** (interface Wi-Fi). Si ton WiFi change,
   récupère-la avec `ipconfig` (ligne "Adresse IPv4" du Wi-Fi).
3. **Backend en écoute réseau** : lancer avec `--host 0.0.0.0` (pas `127.0.0.1`), sinon le
   boîtier ne peut pas l'atteindre :
   ```
   cd backend
   .venv/Scripts/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
   ```
4. **Pare-feu Windows** : au 1er lancement, autorise Python sur les réseaux privés (fenêtre qui
   s'ouvre). Sinon crée la règle (PowerShell admin) :
   `New-NetFirewallRule -DisplayName "EcoWatt 8000" -Direction Inbound -LocalPort 8000 -Protocol TCP -Action Allow`

---

## 3. Configurer le firmware (`firmware/src/main.cpp`)

À adapter par prise, en haut du fichier :

```cpp
WIFI_SSID        = "TON_WIFI";          // nom du WiFi (le même que le PC)
WIFI_PASS        = "TON_MOT_DE_PASSE";
BACKEND_HOST     = "192.168.1.19";      // IP locale du PC (backend)
BACKEND_PORT     = 8000;
PRISE_ID         = "p1";                // identifiant unique de CETTE prise
DEVICE_ID        = "kettle-1";          // identifiant de l'appareil branché
DEVICE_NAME      = "Bouilloire";        // nom affiché (auto-découverte)
DEVICE_PRIORITE  = "reportable";        // essentiel | reportable | confort
```

Chaque boîtier a son `PRISE_ID` / `DEVICE_ID` uniques.

---

## 4. Flasher l'ESP32

Avec **PlatformIO** (recommandé, config déjà dans `firmware/platformio.ini`) :
```
cd firmware
pio run -t upload        # compile et téléverse sur l'ESP32 branché en USB
pio device monitor       # voir les logs (connexion WiFi, WebSocket)
```
Alternative : Arduino IDE (installer les cartes ESP32 + les librairies `WebSockets` de links2004
et `ArduinoJson`).

Dans le moniteur, tu dois voir : `[wifi] IP ...` puis `[ws] connecte au backend`.

---

## 5. Lancer et voir l'appareil apparaître

1. Backend lancé (étape 2).
2. Front : `cd app && npm run dev` → http://localhost:5173
3. Dans l'app, bascule sur **Mode réel** (carte en bas de la sidebar).
4. Branche/alimente le boîtier. Dès sa 1re mesure, l'appareil **apparaît automatiquement** sur
   le Dashboard, la conso monte, et l'IA peut le couper en heure de pointe.

---

## 6. Calibrer la mesure (important)

Dans `firmware/src/main.cpp`, la fonction `readWatts()` a une constante `AMPS_PER_ADC` à 0
(placeholder). Pour des watts justes :
1. Branche une charge de puissance connue (ex. une ampoule 60 W).
2. Relève la valeur brute du capteur (`analogRead`) via le moniteur série.
3. Calcule le facteur pour que `Vrms x Irms` donne la bonne puissance, et mets-le dans
   `AMPS_PER_ADC`.

Tant que ce n'est pas calibré, la prise remonte 0 W (mais la connexion et le relais fonctionnent).

---

## 7. Variante Bluetooth (BLE) — optionnelle

Le WiFi reste recommandé (portée, always-on, multi-prises). Le Bluetooth est un **plan B**
quand il n'y a pas de WiFi. Le cerveau (IA, impact, dashboard, auto-découverte) est identique,
seul le "tuyau" change. ⚠️ Nécessite un **adaptateur Bluetooth sur le PC**, et c'est **codé mais
non validé sans matériel BT**.

**Côté PC (backend) :**
1. Installer la lib : `pip install bleak`
2. Lancer avec le pont BLE activé :
   ```
   set ECOWATT_BLE=1
   .venv/Scripts/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
   ```
   Le backend scanne les boîtiers dont le nom commence par `EcoWatt-` et s'y connecte.

**Côté boîtier (firmware) :**
- Utiliser `firmware/ble/main_ble.cpp` à la place de `src/main.cpp` (le boîtier annonce un
  service BLE au lieu de se connecter en WiFi). Mêmes réglages `PRISE_ID` / `DEVICE_ID` /
  `DEVICE_NAME` / `DEVICE_PRIORITE`.

Le protocole (UUID) est partagé entre `backend/app/config.py` et le firmware : mesures en
notification (`{device_id, watts, nom, priorite}`), ordres relais en écriture (`{prise_id, relais}`).
Comme en WiFi, l'appareil **apparaît tout seul** à sa première mesure.

WiFi et Bluetooth peuvent coexister : certaines prises en WiFi, d'autres en BLE, toutes vues
sur le même dashboard.

## 8. Dépannage

- **L'appareil n'apparaît pas** : vérifie que le PC et l'ESP32 sont sur le MÊME WiFi, que
  `BACKEND_HOST` = l'IP du PC, que le backend tourne en `--host 0.0.0.0`, et le pare-feu.
- **`[ws] deconnecte` en boucle** : IP/port faux, ou pare-feu qui bloque le port 8000.
- **Le dashboard reste sur "Connexion au backend..."** : le backend n'est pas lancé ou pas
  joignable (teste `http://192.168.1.19:8000/docs` dans le navigateur du PC).
- **Watts à 0** : capteur non calibré (voir étape 6) ou relais coupé.
