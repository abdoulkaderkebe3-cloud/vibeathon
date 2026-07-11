/*
 * EcoWatt - firmware d'une prise intelligente (ESP32) en BLUETOOTH (BLE)
 * ----------------------------------------------------------------------
 * Variante Bluetooth du boîtier : à utiliser à la place du WiFi (src/main.cpp).
 * Pour l'utiliser : remplace le contenu de firmware/src/main.cpp par ce fichier
 * (ou pointe le src_dir de PlatformIO ici), puis flashe. Côté PC : ECOWATT_BLE=1.
 *
 * Le boîtier annonce un service BLE ; le backend (via `bleak`) se connecte,
 * s'abonne aux mesures (notify) et envoie les ordres relais (write).
 * ⚠️ Non testé sans matériel BT. UUID identiques à backend/app/config.py.
 *
 * ⚠️ SECURITE 220V : voir src/main.cpp.
 */

#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <ArduinoJson.h>

// UUID (doivent correspondre a backend/app/config.py)
#define SERVICE_UUID "ec0a0000-b5a3-f393-e0a9-e50e24dcca9e"
#define MEASURE_UUID "ec0a0001-b5a3-f393-e0a9-e50e24dcca9e" // notify : mesures
#define COMMAND_UUID "ec0a0002-b5a3-f393-e0a9-e50e24dcca9e" // write  : ordres relais

// --- CONFIGURATION (a adapter par prise) ---
static const char* PRISE_ID        = "p1";
static const char* DEVICE_ID       = "kettle-1";
static const char* DEVICE_NAME     = "Bouilloire";
static const char* DEVICE_PRIORITE = "reportable"; // essentiel | reportable | confort

static const int PIN_RELAY  = 26;
static const int PIN_SENSOR = 34;
static const unsigned long MEASURE_INTERVAL_MS = 1000;

static const float MAINS_VOLTAGE = 230.0;
static const float AMPS_PER_ADC  = 0.0; // TODO calibrer (voir src/main.cpp)

BLECharacteristic* measureChar = nullptr;
bool relayOn = true;
unsigned long lastMeasure = 0;

void setRelay(bool on) {
  relayOn = on;
  digitalWrite(PIN_RELAY, on ? HIGH : LOW);
  Serial.printf("[relay] %s\n", on ? "ON" : "OFF");
}

float readWatts() {
  if (!relayOn) return 0.0f;
  int raw = analogRead(PIN_SENSOR);
  float amps = raw * AMPS_PER_ADC;
  return MAINS_VOLTAGE * amps;
}

// Reçoit les ordres relais du backend
class CommandCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    std::string v = c->getValue();
    JsonDocument doc;
    if (deserializeJson(doc, v)) return;
    const char* relais = doc["relais"] | "";
    if (strcmp(relais, "off") == 0) setRelay(false);
    else if (strcmp(relais, "on") == 0) setRelay(true);
  }
};

void setup() {
  Serial.begin(115200);
  pinMode(PIN_RELAY, OUTPUT);
  setRelay(true);

  String bleName = String("EcoWatt-") + PRISE_ID; // le backend filtre sur ce préfixe
  BLEDevice::init(bleName.c_str());
  BLEServer* server = BLEDevice::createServer();
  BLEService* service = server->createService(SERVICE_UUID);

  measureChar = service->createCharacteristic(MEASURE_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  measureChar->addDescriptor(new BLE2902());

  BLECharacteristic* cmdChar =
      service->createCharacteristic(COMMAND_UUID, BLECharacteristic::PROPERTY_WRITE);
  cmdChar->setCallbacks(new CommandCallbacks());

  service->start();
  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->start();
  Serial.printf("[ble] annonce %s\n", bleName.c_str());
}

void loop() {
  unsigned long now = millis();
  if (now - lastMeasure >= MEASURE_INTERVAL_MS) {
    lastMeasure = now;
    JsonDocument doc;
    doc["device_id"] = DEVICE_ID;
    doc["watts"] = readWatts();
    doc["nom"] = DEVICE_NAME;
    doc["priorite"] = DEVICE_PRIORITE;
    char buf[160];
    size_t n = serializeJson(doc, buf);
    if (measureChar) {
      measureChar->setValue((uint8_t*)buf, n);
      measureChar->notify();
    }
  }
  delay(10);
}
