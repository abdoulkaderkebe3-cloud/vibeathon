# backend/ - Ingestion + cerveau IA + temps réel

Chantier **App & cerveau IA** (partie serveur). **Python + FastAPI** (ADR-003).

Modules prévus (voir `../docs/03-architecture.md`) :
- **ingest** : reçoit les mesures des prises (MQTT), met à jour l'état en mémoire.
- **brain** : appelle un modèle gratuit via **OpenRouter** (endpoint compatible OpenAI),
  produit une décision JSON + explication, validée avec Pydantic (ADR-005).
- **actuator** : traduit la décision en ordre relais vers la prise (MQTT).
- **impact** : calcule kWh / FCFA / CO2 évités (voir `../docs/impact.md`).
- **ws** : pousse l'état complet vers l'app via WebSocket (natif FastAPI).

Dépendances prévues : `fastapi`, `uvicorn`, un client MQTT (`paho-mqtt` ou `aiomqtt`), et un
client HTTP (`openai` pointé sur `https://openrouter.ai/api/v1`, ou `httpx`).

⚠️ Clé OpenRouter dans `.env` (gitignored), générée via `/generer-env`. Jamais en dur, jamais
loggée en clair. Quota gratuit limité : appeler l'IA sur événement + cache + mode dégradé.
