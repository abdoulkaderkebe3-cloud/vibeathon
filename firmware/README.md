# firmware/ - Code des prises intelligentes (ESP32)

Chantier **Prises & firmware** (ADR-001 : voie sur mesure ESP32). Responsabilité : mesurer la
puissance de l'appareil branché, ouvrir/fermer le relais sur ordre, communiquer avec le backend.

Matériel par prise : **ESP32 + capteur de courant** (type SCT-013 non invasif + circuit de
mesure, ou module de mesure de puissance) **+ module relais**.

Communication (ADR-002) : **client WebSocket** vers le backend FastAPI (librairie
`arduinoWebSockets`). La prise pousse ses mesures et reçoit les ordres de coupure/rallumage sur
la même connexion. Pas de broker MQTT.

Contenu prévu : sketch Arduino/PlatformIO (`platformio.ini` + `src/main.cpp`) avec WiFi, client
WebSocket, lecture périodique du capteur, pilotage du relais.

⚠️ Sécurité 220V : ESP32 alimenté isolé du secteur, module relais conçu pour le secteur, jamais
de fil nu sous tension, supervision par un membre à l'aise avec l'électronique (voir la section Sécurité du `../README.md`).
