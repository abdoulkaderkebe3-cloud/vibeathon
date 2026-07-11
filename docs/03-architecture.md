# 03 - Conception & architecture (Étape 3/8)

> Là où le vibe coding s'arrête et la réflexion commence.
> Livrable jury : modèle de données, découpage en modules, flux. Les décisions structurantes
> sont tracées comme ADR dans `DECISIONS.md`.

## Vue d'ensemble du flux

```
  [Prise ESP32]               (serveur HTTP embarqué, 2 prises ACS712 + relais)
     ^ mesure watts (le backend interroge GET /data en boucle)
     |
     v
  [Backend / ingest]  --->  [Backend / brain (cascade LLM + règles)]
     |     |                    | décision JSON + explication
     |     v (SQLite)           v
     | [historique]        [Backend / actuator]
     |                          | ordre relais (HTTP GET /relay?id=&state=)
     |                          v
     |                      [Prise ESP32] coupe/rallume
     v
  [Backend / WebSocket app]  --->  [App dashboard]  (conso live, appareils, log décisions, impact)
```

Note transport (voir ADR-002) : le firmware utilisé est une **variante serveur HTTP** embarquée
sur l'ESP32. Le backend fait du **polling `GET /data`** pour lire les mesures et envoie les ordres
par **`GET /relay?id=&state=`**. Le WebSocket est conservé uniquement en aval, du backend vers
l'app (`/ws/app`). (Des variantes firmware WebSocket et BLE existent aussi dans `firmware/`.)

Point technique clé (à dire au jury) : un seul relais au compteur général ne couperait que
toute la maison. Pour agir sur un appareil précis, il faut une prise intelligente par
appareil. C'est ce qui rend EcoWatt granulaire.

## Modèle de données (SQLite + état live en mémoire, voir ADR-004)

```
Device {
  id: string              // ex: "kettle-1"
  nom: string             // ex: "Bouilloire"
  prise_id: string        // prise physique associée
  priorite: "essentiel" | "reportable" | "confort"
  etat: "on" | "off"
  conso_w: number         // dernière mesure
  replanifie_a?: string   // heure de rallumage prévue (si décalé)
}

Measurement {
  device_id: string
  timestamp: string       // ISO
  watts: number
}

Decision {
  timestamp: string
  device_id: string
  action: "couper" | "rallumer" | "garder"
  raison: string          // explication en langage clair (facteur cité)
  replanifie_a?: string
}

Impact {
  kwh_evites: number
  fcfa_economises: number
  co2_evite_kg: number
}
```

## Découpage en modules (responsabilités claires)

### Firmware (`firmware/`)
- Mesurer la puissance des appareils branchés (2 prises ACS712 : 30A et 5A).
- Ouvrir / fermer le relais sur ordre.
- Exposer un **serveur HTTP** : `GET /data` (mesures) et `GET /relay?id=&state=` (ordre relais).
  Le backend interroge ces routes ; l'ESP32 n'ouvre pas de connexion sortante.

### Backend (`backend/`)
- **ingest** : lit les mesures des prises en interrogeant `GET /data` en boucle
  (`_poll_hardware_loop`), met à jour l'état live en mémoire et persiste dans SQLite.
- **brain** : cerveau IA. Chat via une **cascade de fournisseurs compatibles OpenAI** (Groq 70b
  → Groq 8b → Gemini → Mistral → OpenRouter), bascule automatique sur saturation (429), et
  **repli sur des règles déterministes** si tout échoue (voir ADR-005). Reçoit l'état des
  appareils + le contexte (heure, heure de pointe, budget) et renvoie une décision JSON. En amont,
  les intentions fiables (ordres, tarif, prédiction, questions méta) sont traitées **avant le LLM**.
- **actuator** : traduit la décision en ordre relais et l'envoie à la bonne prise (`GET /relay`).
- **impact** : calcule kWh / FCFA / CO2 évités à partir de la conso réellement évitée.
- **ws** : pousse l'état complet vers l'app en temps réel (WebSocket `/ws/app`).
- **tarif_cie** : barème progressif CIE (social/général), conversions kWh ⇄ FCFA, prix marginal.
- **prediction** : prévision de facture, classement des appareils par coût, calcul prépayé.
- **agregation** : intègre les watts dans le temps (kWh/jour par appareil) pour la prédiction.

### App (`app/`)
- **Zone 1** : consommation temps réel (graphe par appareil).
- **Zone 2** : liste des appareils (nom, priorité, état on/off, watts).
- **Zone 3** : log des décisions de l'IA avec leur explication.
- **Page impact** : kWh / FCFA / CO2 économisés + projection "si 10 000 foyers le font".

## Logique de décision de l'IA (le cœur)

L'IA ne coupe ni au hasard ni sur un simple seuil. Elle croise 4 facteurs (détail
`docs/reference/EcoWatt-Presentation-Equipe.html`) :

1. **Priorité de l'appareil** : l'essentiel n'est jamais coupé (CA4).
2. **Le moment** : en heure de pointe, le réseau est chargé et l'électricité la plus polluante.
3. **L'objectif** : à l'approche d'un budget, délester les appareils reportables.
4. **La conso réelle** : un appareil qui consomme fort sans besoin immédiat devient candidat.

Sortie attendue (contrat, voir ADR-005 : cerveau IA résilient en 3 couches, cascade
Groq/Gemini/Mistral/OpenRouter puis repli sur règles) :
```json
{ "action": "couper", "device_id": "kettle-1",
  "raison": "Heure de pointe et tu approches de ton budget. La bouilloire est reportable, je la coupe et la rallume à 23h.",
  "replanifie_a": "23:00" }
```

## Points d'architecture à figer avec l'équipe

- Fréquence d'appel au cerveau IA (périodique vs déclenché sur pic) : impacte coût et latence.
- Format exact du contexte envoyé au modèle (voir `backend/app/brain.py`).
- Mode dégradé si le modèle est injoignable ou le quota atteint : **implémenté** via la cascade
  multi-fournisseurs puis le repli sur règles déterministes (les ordres, tarifs et prédictions
  restent fiables sans LLM).
