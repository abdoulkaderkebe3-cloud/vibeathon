/*
 * EcoWatt - firmware d'une prise intelligente (ESP32) - VARIANTE SERVEUR HTTP - v3
 * -------------------------------------------------------------------------------
 * C'est le firmware REELLEMENT utilise pour la demo (2 prises ACS712 + 2 relais + LEDs).
 * L'ESP32 est un SERVEUR web : le backend EcoWatt l'interroge en HTTP (polling).
 *
 *   GET /data                  -> mesures des 2 prises (courant RMS, puissance, energie, etat)
 *   GET /relay?id=1&state=on   -> pilote le relais 1 (on|off), idem id=2
 *   GET /raw                   -> diagnostic : tensions brutes, bruit, facteurs (calibration)
 *   GET /zero                  -> MISE A ZERO : a appeler RIEN BRANCHE. Memorise le bruit residuel.
 *   GET /calib?prise=1&watts=1000 -> ETALONNAGE avec une charge de puissance CONNUE.
 *   GET /config                -> valeurs memorisees (zero + etalonnage)
 *   GET /reset                 -> efface la memoire (retour aux valeurs d'usine)
 *
 * ============================ POURQUOI CETTE v3 ============================
 * La v2 lisait des centaines de watts SANS RIEN DE BRANCHE, et parfois PLUS quand le relais
 * etait coupe (donc quand aucun courant ne peut physiquement circuler). Cause : elle figeait
 * l'offset du capteur UNE SEULE FOIS au demarrage, puis calculait sqrt(moyenne((v - offset)^2)).
 * Cette formule ne mesure pas que l'ondulation alternative : elle compte AUSSI tout ecart continu
 * par rapport a l'offset memorise. Or l'offset d'un ACS712 vaut Vcc/2 : il derive des que
 * l'alimentation bouge (les bobines des relais et les LEDs tirent du courant) ou que le capteur
 * chauffe. Un decalage de 0,30 V suffisait a fabriquer ~356 W de courant fantome.
 *
 * Corrections, dans l'ordre d'importance :
 *   1. OFFSET DYNAMIQUE. On calcule la moyenne DANS LA MEME FENETRE que le RMS et on la retranche :
 *      vrms = ecart-type du signal = sqrt(moyenne(v^2) - moyenne(v)^2). Toute derive continue
 *      disparait par construction, quelle qu'en soit la cause. (Algorithme de Welford, stable.)
 *   2. RELAIS OUVERT => 0 W, impose. Aucun courant ne peut traverser un contact ouvert : le
 *      mesurer serait une absurdite physique. On ne fait donc meme pas confiance au capteur.
 *   3. ZERO MEMORISE (tare). Il reste un bruit de fond (ADC + capteur). On le mesure une fois,
 *      rien branche, via /zero, et on le retranche en quadrature : les bruits independants
 *      s'additionnent en puissance, donc vrms_net = sqrt(vrms^2 - bruit^2), pas vrms - bruit.
 *   4. ZONE MORTE. Sous SEUIL_W, on affiche 0 : une prise vide doit afficher zero, pas "3 W".
 *   5. analogReadMilliVolts() au lieu de analogRead() : applique la courbe de calibration usine
 *      de l'ESP32. Son ADC est notoirement non lineaire, une simple regle de trois est fausse.
 *   6. Mesure en continu dans loop() + lissage. /data repond instantanement (avant : 120 ms de
 *      mesure bloquante a chaque requete, alors que le backend interroge chaque seconde).
 *
 * ======================== PROCEDURE DE CALIBRATION ========================
 * Elle ne demande AUCUN reflashage : les valeurs sont gardees en memoire permanente (NVS).
 *   1. Rien branche sur les 2 prises, relais allumes.  ->  GET /zero
 *   2. Verifier : GET /data doit afficher 0 W sur les deux prises.
 *   3. Brancher le fer a repasser (1000 W) sur la prise 1, le laisser CHAUFFER (il doit tirer
 *      son courant nominal, pas etre en regulation).   ->  GET /calib?prise=1&watts=1000
 *   4. Brancher l'ampoule sur la prise 2.              ->  GET /calib?prise=2&watts=<sa puissance>
 *      /!\ Ampoule a FILAMENT uniquement. Une LED a un facteur de puissance qui rend le calcul
 *      P = U x I faux, et sa faible intensite se noie dans le bruit.
 *   5. GET /config pour verifier, puis reporter les facteurs dans CALIB_* ci-dessous (optionnel,
 *      pour qu'un ESP32 reflashe reparte deja etalonne).
 *
 * ⚠️ SECURITE 220V : l'ESP32 est alimente isole du secteur, les modules relais sont concus pour
 *    le secteur, jamais de fil nu sous tension, montage supervise.
 *
 * --- ARDUINO IDE ---
 * Board : "ESP32 Dev Module"   |   Port : le COM du CH340   |   Moniteur serie : 115200 bauds
 */

#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include <math.h>
#include "arduino_secrets.h"  // WIFI_SSID / WIFI_PASS — fichier local, jamais commite

// ---- WiFi (le MEME reseau que le PC qui lance le backend) ----
const char* ssid     = WIFI_SSID;
const char* password = WIFI_PASS;

// ---- Broches capteurs et relais ----
#define PIN_ACS712_30A  34
#define PIN_ACS712_5A   35
#define PIN_RELAY_1     26
#define PIN_RELAY_2     27

// ---- Broches LED ----
#define PIN_LED1_VERTE   15
#define PIN_LED1_ROUGE   16
#define PIN_LED2_VERTE   17
#define PIN_LED2_ROUGE   18

#define RELAY_ON   LOW
#define RELAY_OFF  HIGH

// ---- Constantes electriques ----
// Sensibilite theorique de l'ACS712 sous 5 V : 66 mV/A (30A) et 185 mV/A (5A).
// Si le capteur est alimente en 3,3 V, ou si sa sortie passe par un diviseur de tension avant
// l'ESP32, la sensibilite REELLE est plus faible. Peu importe : le facteur d'etalonnage
// (/calib, memorise en NVS) absorbe l'ecart. On part du theorique.
#define SENSIBILITE_30A  0.066f   // V par ampere
#define SENSIBILITE_5A   0.185f   // V par ampere
#define TENSION_SECTEUR  220.0f   // V (Cote d'Ivoire)

// Zone morte : sous ce seuil, on affiche 0 W. Une prise vide doit afficher zero.
#define SEUIL_W  4.0f

// Valeurs d'usine, ecrasees par ce qui est memorise en NVS (voir /calib et /zero).
#define CALIB_30A_DEFAUT  1.0f
#define CALIB_5A_DEFAUT   1.0f

// Fenetre de mesure : 100 ms = 5 periodes pleines a 50 Hz. Un nombre entier de periodes evite
// de biaiser l'ecart-type en coupant une sinusoide au milieu.
#define FENETRE_US   100000UL
#define PERIODE_MESURE_MS  200   // on mesure 5 fois par seconde

// Lissage exponentiel de la mesure affichee (0 = fige, 1 = aucune inertie).
#define LISSAGE  0.35f

// ---- Etat memorise (NVS) ----
Preferences prefs;
float calib30 = CALIB_30A_DEFAUT;   // facteur d'etalonnage, sans unite
float calib5  = CALIB_5A_DEFAUT;
float bruit30_mV = 0.0f;            // ecart-type residuel a vide (tare)
float bruit5_mV  = 0.0f;

// ---- Etat live ----
bool relais1_actif = true;
bool relais2_actif = true;

float vrms30_mV = 0.0f;   // ecart-type brut lisse, capteur 30A (avant tare)
float vrms5_mV  = 0.0f;
float mean30_mV = 0.0f;   // tension continue moyenne (doit valoir Vcc/2 si le capteur est sain)
float mean5_mV  = 0.0f;
float courant1_A = 0.0f;  // apres tare, etalonnage et zone morte
float courant2_A = 0.0f;

float energie1_kWh = 0;
float energie2_kWh = 0;
unsigned long dernierCalcul = 0;
unsigned long derniereMesure = 0;

WebServer server(80);

void majLED(int prise, bool actif) {
  if (prise == 1) {
    digitalWrite(PIN_LED1_VERTE, actif ? HIGH : LOW);
    digitalWrite(PIN_LED1_ROUGE, actif ? LOW : HIGH);
  } else if (prise == 2) {
    digitalWrite(PIN_LED2_VERTE, actif ? HIGH : LOW);
    digitalWrite(PIN_LED2_ROUGE, actif ? LOW : HIGH);
  }
}

/*
 * Ondulation du signal sur une fenetre, en millivolts (ecart-type, algorithme de Welford).
 * Si moyenne_mV n'est pas nul, on y ecrit aussi la composante continue.
 *
 * C'est le coeur de la correction v3. On ne soustrait PAS un offset memorise au demarrage :
 * on soustrait la moyenne mesuree dans cette fenetre-ci. Resultat : la composante continue
 * (l'offset Vcc/2 du capteur, et toutes ses derives) est eliminee, et il ne reste que
 * l'ondulation alternative, c'est-a-dire le courant. Welford plutot que la formule naive
 * moyenne(v^2) - moyenne(v)^2 : celle-ci soustrait deux grands nombres presque egaux
 * (~2 720 000 chacun pour un ecart-type de 10) et perd toute precision.
 *
 * La moyenne est un outil de DIAGNOSTIC precieux. Un ACS712 sain et alimente sort une continue
 * stable a Vcc/2. Une broche debranchee, elle, "flotte" : elle capte le 50 Hz ambiant, ce qui
 * donne une ondulation enorme alors qu'aucun courant ne circule.
 */
float mesurerFenetre_mV(int pin, float* moyenne_mV) {
  double moyenne = 0.0, m2 = 0.0;
  uint32_t n = 0;
  unsigned long t0 = micros();
  while (micros() - t0 < FENETRE_US) {
    double x = (double)analogReadMilliVolts(pin);
    n++;
    double delta = x - moyenne;
    moyenne += delta / n;
    m2 += delta * (x - moyenne);
  }
  if (n < 2) {
    if (moyenne_mV) *moyenne_mV = 0.0f;
    return 0.0f;
  }
  if (moyenne_mV) *moyenne_mV = (float)moyenne;
  return (float)sqrt(m2 / (double)n);
}

// Raccourci pour les appels qui ne veulent que l'ondulation.
float ecartTypeFenetre_mV(int pin) {
  return mesurerFenetre_mV(pin, nullptr);
}

/*
 * Courant efficace (A) a partir de l'ecart-type brut.
 * On retranche le bruit de fond EN QUADRATURE : deux bruits independants s'additionnent en
 * puissance, pas en amplitude. Retrancher betement bruit_mV sous-estimerait les vraies charges.
 */
float courantDepuisVrms(float vrms_mV, float bruit_mV, float sensibilite, float calib) {
  float net_mV2 = vrms_mV * vrms_mV - bruit_mV * bruit_mV;
  if (net_mV2 <= 0.0f) return 0.0f;
  float net_V = sqrt(net_mV2) / 1000.0f;
  return (net_V / sensibilite) * calib;
}

// Met a jour les mesures lissees. Appelee regulierement depuis loop().
void rafraichirMesures() {
  float moy30 = 0.0f, moy5 = 0.0f;
  float ecart30 = mesurerFenetre_mV(PIN_ACS712_30A, &moy30);
  float ecart5  = mesurerFenetre_mV(PIN_ACS712_5A,  &moy5);
  vrms30_mV += LISSAGE * (ecart30 - vrms30_mV);
  vrms5_mV  += LISSAGE * (ecart5  - vrms5_mV);
  mean30_mV += LISSAGE * (moy30 - mean30_mV);
  mean5_mV  += LISSAGE * (moy5  - mean5_mV);

  // Relais ouvert => aucun courant possible. On n'interroge meme pas le capteur.
  courant1_A = relais1_actif
      ? courantDepuisVrms(vrms30_mV, bruit30_mV, SENSIBILITE_30A, calib30) : 0.0f;
  courant2_A = relais2_actif
      ? courantDepuisVrms(vrms5_mV, bruit5_mV, SENSIBILITE_5A, calib5) : 0.0f;

  // Zone morte : une prise vide affiche zero, pas quelques watts de residu.
  if (courant1_A * TENSION_SECTEUR < SEUIL_W) courant1_A = 0.0f;
  if (courant2_A * TENSION_SECTEUR < SEUIL_W) courant2_A = 0.0f;
}

void chargerMemoire() {
  prefs.begin("ecowatt", false);
  calib30    = prefs.getFloat("calib30", CALIB_30A_DEFAUT);
  calib5     = prefs.getFloat("calib5",  CALIB_5A_DEFAUT);
  bruit30_mV = prefs.getFloat("bruit30", 0.0f);
  bruit5_mV  = prefs.getFloat("bruit5",  0.0f);
  Serial.printf("Memoire : calib30=%.3f calib5=%.3f bruit30=%.1f mV bruit5=%.1f mV\n",
                calib30, calib5, bruit30_mV, bruit5_mV);
}

void handleData() {
  float puissance1 = courant1_A * TENSION_SECTEUR;
  float puissance2 = courant2_A * TENSION_SECTEUR;

  String json = "{";
  json += "\"prise1\":{";
  json += "\"nom\":\"30A\",";
  json += "\"courant_A\":" + String(courant1_A, 2) + ",";
  json += "\"puissance_W\":" + String(puissance1, 1) + ",";
  json += "\"energie_kWh\":" + String(energie1_kWh, 4) + ",";
  json += "\"etat\":" + String(relais1_actif ? "true" : "false");
  json += "},";
  json += "\"prise2\":{";
  json += "\"nom\":\"5A\",";
  json += "\"courant_A\":" + String(courant2_A, 2) + ",";
  json += "\"puissance_W\":" + String(puissance2, 1) + ",";
  json += "\"energie_kWh\":" + String(energie2_kWh, 4) + ",";
  json += "\"etat\":" + String(relais2_actif ? "true" : "false");
  json += "}";
  json += "}";

  server.send(200, "application/json", json);
}

/*
 * Diagnostic : tout ce qu'il faut pour comprendre une mesure douteuse, sans reflasher.
 * "continue_mV" est la cle : un ACS712 alimente et cable sort Vcc/2 (~1650 mV sous 3,3 V,
 * ~2500 mV sous 5 V) de facon STABLE. Une valeur tres eloignee, ou une grosse ondulation
 * alors qu'aucun courant ne circule, trahit une broche qui flotte (fil debranche, capteur
 * non alimente, masse non commune).
 */
void handleRaw() {
  String json = "{";
  json += "\"prise1\":{\"vrms_brut_mV\":" + String(vrms30_mV, 2)
        + ",\"continue_mV\":" + String(mean30_mV, 1)
        + ",\"bruit_mV\":" + String(bruit30_mV, 2)
        + ",\"calib\":" + String(calib30, 4)
        + ",\"courant_A\":" + String(courant1_A, 3)
        + ",\"relais\":" + String(relais1_actif ? "true" : "false") + "},";
  json += "\"prise2\":{\"vrms_brut_mV\":" + String(vrms5_mV, 2)
        + ",\"continue_mV\":" + String(mean5_mV, 1)
        + ",\"bruit_mV\":" + String(bruit5_mV, 2)
        + ",\"calib\":" + String(calib5, 4)
        + ",\"courant_A\":" + String(courant2_A, 3)
        + ",\"relais\":" + String(relais2_actif ? "true" : "false") + "},";
  json += "\"seuil_W\":" + String(SEUIL_W, 1);
  json += "}";
  server.send(200, "application/json", json);
}

/*
 * MISE A ZERO (tare). A appeler RIEN BRANCHE, relais allumes : on memorise le bruit de fond
 * reel, dans les conditions exactes de la demo (relais colles, WiFi actif, capteur chaud).
 * On moyenne plusieurs fenetres, sinon on memoriserait le hasard d'un instant.
 */
void handleZero() {
  const int N = 15;
  double s30 = 0, s5 = 0;
  for (int i = 0; i < N; i++) {
    s30 += ecartTypeFenetre_mV(PIN_ACS712_30A);
    s5  += ecartTypeFenetre_mV(PIN_ACS712_5A);
  }
  bruit30_mV = (float)(s30 / N);
  bruit5_mV  = (float)(s5 / N);
  prefs.putFloat("bruit30", bruit30_mV);
  prefs.putFloat("bruit5",  bruit5_mV);

  // On repart de la mesure fraiche, sinon le lissage traine l'ancienne valeur.
  vrms30_mV = bruit30_mV;
  vrms5_mV  = bruit5_mV;

  Serial.printf("/zero -> bruit30=%.2f mV, bruit5=%.2f mV\n", bruit30_mV, bruit5_mV);
  String json = "{\"ok\":true,\"bruit30_mV\":" + String(bruit30_mV, 2)
              + ",\"bruit5_mV\":" + String(bruit5_mV, 2)
              + ",\"note\":\"tare memorisee ; /data doit afficher 0 W\"}";
  server.send(200, "application/json", json);
}

/*
 * ETALONNAGE avec une charge de puissance CONNUE, branchee et en regime etabli.
 * facteur = courant_attendu / courant_lu_sans_facteur.
 */
void handleCalib() {
  if (!server.hasArg("prise") || !server.hasArg("watts")) {
    server.send(400, "application/json",
                "{\"erreur\":\"usage: /calib?prise=1&watts=1000\"}");
    return;
  }
  int prise = server.arg("prise").toInt();
  float watts = server.arg("watts").toFloat();
  if ((prise != 1 && prise != 2) || watts <= 0) {
    server.send(400, "application/json", "{\"erreur\":\"prise=1|2 et watts>0\"}");
    return;
  }

  bool relais = (prise == 1) ? relais1_actif : relais2_actif;
  if (!relais) {
    server.send(409, "application/json",
                "{\"erreur\":\"relais coupe : aucun courant ne circule, allume la prise\"}");
    return;
  }

  float vrms   = (prise == 1) ? vrms30_mV : vrms5_mV;
  float bruit  = (prise == 1) ? bruit30_mV : bruit5_mV;
  float sensib = (prise == 1) ? SENSIBILITE_30A : SENSIBILITE_5A;

  float lu_A = courantDepuisVrms(vrms, bruit, sensib, 1.0f);  // sans facteur
  if (lu_A < 0.01f) {
    server.send(409, "application/json",
                "{\"erreur\":\"aucun courant mesure : la charge est-elle branchee et allumee ?\"}");
    return;
  }

  float attendu_A = watts / TENSION_SECTEUR;
  float facteur = attendu_A / lu_A;
  if (facteur < 0.05f || facteur > 50.0f) {
    String e = "{\"erreur\":\"facteur aberrant (" + String(facteur, 3)
             + ") : verifie le cablage, la charge et la prise choisie\"}";
    server.send(409, "application/json", e);
    return;
  }

  if (prise == 1) { calib30 = facteur; prefs.putFloat("calib30", facteur); }
  else            { calib5  = facteur; prefs.putFloat("calib5",  facteur); }

  Serial.printf("/calib prise %d : lu %.3f A, attendu %.3f A -> facteur %.4f\n",
                prise, lu_A, attendu_A, facteur);
  String json = "{\"ok\":true,\"prise\":" + String(prise)
              + ",\"courant_lu_A\":" + String(lu_A, 3)
              + ",\"courant_attendu_A\":" + String(attendu_A, 3)
              + ",\"facteur\":" + String(facteur, 4) + "}";
  server.send(200, "application/json", json);
}

void handleConfig() {
  String json = "{\"calib30\":" + String(calib30, 4)
              + ",\"calib5\":" + String(calib5, 4)
              + ",\"bruit30_mV\":" + String(bruit30_mV, 2)
              + ",\"bruit5_mV\":" + String(bruit5_mV, 2)
              + ",\"seuil_W\":" + String(SEUIL_W, 1)
              + ",\"tension_V\":" + String(TENSION_SECTEUR, 1) + "}";
  server.send(200, "application/json", json);
}

void handleReset() {
  prefs.clear();
  calib30 = CALIB_30A_DEFAUT;
  calib5  = CALIB_5A_DEFAUT;
  bruit30_mV = 0.0f;
  bruit5_mV  = 0.0f;
  server.send(200, "application/json", "{\"ok\":true,\"note\":\"memoire effacee\"}");
}

void handleRelay() {
  if (!server.hasArg("id") || !server.hasArg("state")) {
    server.send(400, "application/json", "{\"erreur\":\"parametres manquants\"}");
    return;
  }

  int id = server.arg("id").toInt();
  String state = server.arg("state");
  bool activer = (state == "on");

  if (id == 1) {
    relais1_actif = activer;
    digitalWrite(PIN_RELAY_1, activer ? RELAY_ON : RELAY_OFF);
    majLED(1, activer);
  } else if (id == 2) {
    relais2_actif = activer;
    digitalWrite(PIN_RELAY_2, activer ? RELAY_ON : RELAY_OFF);
    majLED(2, activer);
  } else {
    server.send(400, "application/json", "{\"erreur\":\"id invalide\"}");
    return;
  }

  server.send(200, "application/json", "{\"ok\":true}");
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  pinMode(PIN_RELAY_1, OUTPUT);
  pinMode(PIN_RELAY_2, OUTPUT);
  pinMode(PIN_LED1_VERTE, OUTPUT);
  pinMode(PIN_LED1_ROUGE, OUTPUT);
  pinMode(PIN_LED2_VERTE, OUTPUT);
  pinMode(PIN_LED2_ROUGE, OUTPUT);

  // ADC : pleine echelle (~0-3,3 V). analogReadMilliVolts applique la calibration d'usine.
  analogSetPinAttenuation(PIN_ACS712_30A, ADC_11db);
  analogSetPinAttenuation(PIN_ACS712_5A,  ADC_11db);

  chargerMemoire();

  /*
   * ORDRE DE DEMARRAGE : relais OUVERTS d'abord, WiFi ensuite, relais fermes en dernier.
   *
   * La v2 collait les deux relais AVANT d'allumer la radio. Les deux bobines (~140 mA) plus le
   * pic d'emission WiFi (> 300 mA) faisaient chuter l'alimentation sous le seuil du detecteur de
   * sous-tension : "Brownout detector was triggered", reset, et la carte repartait en boucle sans
   * jamais se connecter. On etale donc les appels de courant dans le temps : radio d'abord,
   * puis un relais, puis l'autre. Une prise qui demarre ouverte est aussi le comportement le
   * plus sur apres une coupure de courant.
   */
  relais1_actif = false;
  relais2_actif = false;
  digitalWrite(PIN_RELAY_1, RELAY_OFF);
  digitalWrite(PIN_RELAY_2, RELAY_OFF);
  majLED(1, false);
  majLED(2, false);
  delay(200);

  // Premiere mesure pour amorcer le lissage (sinon la valeur monte lentement au demarrage).
  vrms30_mV = mesurerFenetre_mV(PIN_ACS712_30A, &mean30_mV);
  vrms5_mV  = mesurerFenetre_mV(PIN_ACS712_5A,  &mean5_mV);
  Serial.printf("Capteurs au repos : 30A continue=%.0f mV ondul=%.1f mV | "
                "5A continue=%.0f mV ondul=%.1f mV\n",
                mean30_mV, vrms30_mV, mean5_mV, vrms5_mV);
  Serial.println("(une continue stable ~Vcc/2 et une faible ondulation = capteur sain ;"
                 " une ondulation de plusieurs centaines de mV a vide = broche qui flotte)");

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  WiFi.setTxPower(WIFI_POWER_11dBm);  // ecrete le pic d'emission (portee largement suffisante)
  Serial.print("Connexion WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("Connecte ! IP : ");
  Serial.println(WiFi.localIP());

  // Radio stabilisee : on peut coller les relais, un par un.
  delay(300);
  relais1_actif = true;
  digitalWrite(PIN_RELAY_1, RELAY_ON);
  majLED(1, true);
  delay(300);
  relais2_actif = true;
  digitalWrite(PIN_RELAY_2, RELAY_ON);
  majLED(2, true);

  server.on("/data",   handleData);
  server.on("/relay",  handleRelay);
  server.on("/raw",    handleRaw);
  server.on("/zero",   handleZero);
  server.on("/calib",  handleCalib);
  server.on("/config", handleConfig);
  server.on("/reset",  handleReset);
  server.begin();
  Serial.println("Serveur web demarre.");
  Serial.println("Calibration : /zero (rien branche), puis /calib?prise=1&watts=1000");

  dernierCalcul = millis();
  derniereMesure = millis();
}

void loop() {
  server.handleClient();

  unsigned long maintenant = millis();

  // Mesure periodique (et non a chaque requete HTTP : /data doit repondre instantanement).
  if (maintenant - derniereMesure >= PERIODE_MESURE_MS) {
    derniereMesure = maintenant;
    rafraichirMesures();

    float dt_heures = (maintenant - dernierCalcul) / 3600000.0f;
    energie1_kWh += (courant1_A * TENSION_SECTEUR * dt_heures) / 1000.0f;
    energie2_kWh += (courant2_A * TENSION_SECTEUR * dt_heures) / 1000.0f;
    dernierCalcul = maintenant;
  }
}
