"""Configuration EcoWatt, chargée depuis l'environnement (.env)."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="", extra="ignore")

    # IA — Groq (natif, tool calling)
    groq_api_key: str = ""
    groq_model: str = "llama-3.3-70b-versatile"

    # IA — 2e modèle Groq (MÊME clé, quota TPD séparé par modèle => bascule gratuite immédiate)
    groq_model_fallback: str = "llama-3.1-8b-instant"
    # Cascade Groq : liste ORDONNÉE de modèles (même clé, quota SÉPARÉ par modèle = autant de filets
    # gratuits). Surchargeable via l'env GROQ_MODELS (séparés par des virgules).
    groq_models: str = (
        "llama-3.3-70b-versatile,"
        "llama-3.1-8b-instant,"
        "meta-llama/llama-4-scout-17b-16e-instruct,"
        "openai/gpt-oss-120b,"
        "openai/gpt-oss-20b"
    )

    # IA — Google Gemini (fournisseur de secours, tier gratuit très généreux, compatible OpenAI)
    gemini_api_key: str = ""
    # ⚠️ Modèles Gemini volatils : 2.5-flash et 2.5-flash-lite ont été RETIRÉS (404), 2.0-flash*
    # est en quota (429), flash-latest et 3.5-flash en 503. Vérifié le 2026-07-09. Ces deux-là
    # répondent et supportent le tool calling (indispensable pour les ordres de coupure).
    gemini_model: str = "gemini-flash-lite-latest"
    gemini_models: str = "gemini-flash-lite-latest,gemini-3.1-flash-lite"
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta/openai"

    # IA — Mistral (secours optionnel, compatible OpenAI)
    mistral_api_key: str = ""
    mistral_model: str = "mistral-small-latest"
    mistral_base_url: str = "https://api.mistral.ai/v1"

    # IA — OpenRouter (fallback, compatible OpenAI)
    openrouter_api_key: str = ""
    ecowatt_model: str = "deepseek/deepseek-chat-v3-0324:free"
    ecowatt_mock: int = 1  # 1 = pas d'appel réseau, décisions simulées
    openrouter_base_url: str = "https://openrouter.ai/api/v1"

    # Logique de décision
    ecowatt_peak_start: int = 18
    ecowatt_peak_end: int = 22
    ecowatt_pic_watts: int = 800

    # Impact (à sourcer, voir docs/impact.md)
    ecowatt_prix_kwh_fcfa: float = 79.0
    ecowatt_co2_kg_par_kwh: float = 0.5

    # Base de données
    database_url: str = "sqlite:///ecowatt.db"

    # Bluetooth (BLE) — transport optionnel en plus du WiFi (nécessite un adaptateur BT + `bleak`)
    ecowatt_ble: int = 0  # 1 = active le pont Bluetooth
    ble_name_prefix: str = "EcoWatt-"  # les boîtiers BLE annoncent un nom commençant par ça
    ble_service_uuid: str = "ec0a0000-b5a3-f393-e0a9-e50e24dcca9e"
    ble_measure_uuid: str = "ec0a0001-b5a3-f393-e0a9-e50e24dcca9e"  # notify : mesures
    ble_command_uuid: str = "ec0a0002-b5a3-f393-e0a9-e50e24dcca9e"  # write : ordres relais

    # Matériel (ESP32 en mode serveur HTTP)
    ecowatt_hardware_url: str = "http://192.168.1.153"
    # Puissance (W) au-dessus de laquelle on considère qu'un appareil est branché et consomme
    # sur une prise ALLUMÉE. À relever tant que les capteurs ACS712 ne sont pas calibrés
    # (bruit à vide), à baisser vers ~2-5 W une fois la mesure propre.
    ecowatt_seuil_present_watts: float = 5.0

    # Filtrage du bruit des capteurs ACS712 (mitigation logicielle, en attendant la calibration
    # matérielle). Une fois la tare faite à vide, toute mesure sous ce seuil (après soustraction de
    # la tare) est ramenée à 0 : ça élimine le fond de bruit sans masquer un vrai appareil.
    ecowatt_bruit_zone_morte_w: float = 25.0

    @property
    def use_mock(self) -> bool:
        # Mock si demandé explicitement ou si AUCUNE clé de fournisseur n'est fournie.
        return bool(self.ecowatt_mock) or not (
            self.groq_api_key or self.gemini_api_key
            or self.mistral_api_key or self.openrouter_api_key
        )


settings = Settings()
