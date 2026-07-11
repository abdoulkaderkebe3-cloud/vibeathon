/*
 * EcoWatt - firmware d'une prise intelligente (ESP32)
 * -----------------------------------------------------
 * Role : mesurer la puissance de l'appareil branche, piloter le relais,
 *        parler au backend FastAPI via WebSocket (ADR-002).
 *
 * Flux :
 *   - toutes les MEASURE_INTERVAL_MS, envoie {"device_id","watts"} au backend
 *   - ecoute les ordres {"prise_id","relais":"on|off"} et commande le relais
 *
 * ⚠️ SECURITE 220V : l'ESP32 est alimente isole du secteur, le module relais est
 *    concu pour le secteur, jamais de fil nu sous tension, montage supervise.
 *
 * A CALIBRER avant la demo : la lecture du capteur de courant (voir
 * readWatts()).
 */

#include <Arduino.h>
#include <ArduinoJson.h>
#include <WebSocketsClient.h>
#include <WiFi.h>

// ---------- CONFIGURATION (a adapter par prise) ----------
static const char *WIFI_SSID =
    "Kebe"; // nom du WiFi (le MEME que le PC backend)
// - ESP32 = 2.4 GHz uniquement
static const char *WIFI_PASS = "Code2026@@."; // mot de passe du WiFi
static const char *BACKEND_HOST =
    "192.168.1.12"; // IP locale du PC qui lance le backend
static const uint16_t BACKEND_PORT = 8000; // port du backend

static const char *PRISE_ID = "p2";        // identifiant physique de la prise
static const char *DEVICE_ID = "kettle-1"; // appareil branche dessus
static const char *DEVICE_NAME = "Bouilloire"; // nom affiche (auto-decouverte)
static const char *DEVICE_PRIORITE =
    "reportable"; // essentiel | reportable | confort

static const int PIN_RELAY = 26;  // sortie vers le module relais
static const int PIN_SENSOR = 34; // entree analogique du capteur de courant
static const unsigned long MEASURE_INTERVAL_MS = 1000;

// Calibration capteur (SCT-013 + circuit de mesure). A ajuster avec une charge
// connue.
static const float MAINS_VOLTAGE = 230.0; // tension secteur nominale
static const float AMPS_PER_ADC = 0.0;    // TODO: calibrer (A par unite ADC)

// ---------- ETAT ----------
WebSocketsClient ws;
unsigned long lastMeasure = 0;
bool relayOn = true;

void setRelay(bool on) {
  relayOn = on;
  digitalWrite(PIN_RELAY,
               on ? HIGH : LOW); // adapter selon module (actif haut/bas)
  Serial.printf("[relay] %s\n", on ? "ON" : "OFF");
}

// Lit la puissance instantanee (W). Placeholder a calibrer.
float readWatts() {
  if (!relayOn)
    return 0.0f; // coupe = pas de conso
  // TODO calibration reelle : mesurer le courant RMS puis P = Vrms * Irms.
  // Squelette : lecture brute -> courant approx -> puissance.
  int raw = analogRead(PIN_SENSOR);
  float amps = raw * AMPS_PER_ADC; // AMPS_PER_ADC=0 -> 0 tant que non calibre
  return MAINS_VOLTAGE * amps;
}

void onWsEvent(WStype_t type, uint8_t *payload, size_t length) {
  switch (type) {
  case WStype_CONNECTED:
    Serial.println("[ws] connecte au backend");
    break;
  case WStype_DISCONNECTED:
    Serial.println("[ws] deconnecte");
    break;
  case WStype_TEXT: {
    // Ordre attendu : {"prise_id":"p2","relais":"on|off"}
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, payload, length);
    if (err) {
      Serial.println("[ws] JSON invalide");
      return;
    }
    const char *relais = doc["relais"] | "";
    if (strcmp(relais, "off") == 0)
      setRelay(false);
    else if (strcmp(relais, "on") == 0)
      setRelay(true);
    break;
  }
  default:
    break;
  }
}

void sendMeasurement() {
  if (!ws.isConnected())
    return;
  JsonDocument doc;
  doc["device_id"] = DEVICE_ID;
  doc["watts"] = readWatts();
  doc["nom"] = DEVICE_NAME; // permet l'auto-decouverte cote backend
  doc["priorite"] = DEVICE_PRIORITE;
  char buf[128];
  size_t n = serializeJson(doc, buf);
  ws.sendTXT(buf, n);
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_RELAY, OUTPUT);
  setRelay(true);

  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("[wifi] connexion");
  while (WiFi.status() != WL_CONNECTED) {
    delay(300);
    Serial.print(".");
  }
  Serial.printf("\n[wifi] IP %s\n", WiFi.localIP().toString().c_str());

  // Connexion WebSocket : /ws/prise/<PRISE_ID>
  String path = String("/ws/prise/") + PRISE_ID;
  ws.begin(BACKEND_HOST, BACKEND_PORT, path);
  ws.onEvent(onWsEvent);
  ws.setReconnectInterval(2000);
}

void loop() {
  ws.loop();
  unsigned long now = millis();
  if (now - lastMeasure >= MEASURE_INTERVAL_MS) {
    lastMeasure = now;
    sendMeasurement();
  }
}
