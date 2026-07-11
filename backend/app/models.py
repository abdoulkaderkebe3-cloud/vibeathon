"""
================================================================================
 models.py — Le MODÈLE DE DONNÉES d'EcoWatt
================================================================================

Ce fichier décrit la FORME des données qu'on stocke dans la base SQLite : quels
"objets" existent (les appareils, les mesures, les décisions de l'IA) et quels
champs les composent. C'est le plan de la base de données.

On utilise **SQLModel** : une bibliothèque qui combine deux mondes.
  - Pydantic  : validation/typage des données (on est sûr qu'un "watts" est un nombre) ;
  - SQLAlchemy : traduction automatique de nos classes Python en TABLES SQL.
Autrement dit : une classe Python ici = une table dans la base. Un attribut = une colonne.

Référence : docs/03-architecture.md (choix SQLite = ADR-004).
"""

# `from __future__ import annotations` : permet d'écrire les types de façon moderne
# (ex : `Optional[str]`) sans souci de version de Python. À laisser en 1re ligne de code.
from __future__ import annotations

from datetime import datetime
from enum import Enum

# Field : sert à préciser les détails d'une colonne (clé primaire, index, valeur par défaut).
# SQLModel : la classe de base ; en hériter (avec table=True) crée une vraie table SQL.
from sqlmodel import Field, SQLModel


class Priorite(str, Enum):
    """
    Les trois niveaux de PRIORITÉ d'un appareil. C'est le cœur de la logique EcoWatt :
    l'IA décide quoi couper en fonction de cette priorité.

    On hérite de (str, Enum) => c'est une énumération dont les valeurs sont des chaînes.
    Avantage : en base et dans l'API JSON, on stocke/renvoie directement "essentiel",
    "reportable" ou "confort" (lisible), tout en gardant la sécurité d'un ensemble fermé
    de valeurs autorisées (impossible d'écrire une priorité invalide).
    """
    essentiel = "essentiel"    # jamais coupé, ex : réfrigérateur (critère d'acceptation CA4)
    reportable = "reportable"  # décalable hors des heures de pointe, ex : bouilloire, fer
    confort = "confort"        # coupable si besoin, ex : télévision, ventilateur


class Action(str, Enum):
    """
    L'ACTION décidée par l'IA pour un appareil donné. Même principe que Priorite :
    un ensemble fermé de valeurs, stockées en clair.
    """
    couper = "couper"      # éteindre l'appareil (couper le relais de la prise)
    rallumer = "rallumer"  # le rallumer
    garder = "garder"      # ne rien changer


class Device(SQLModel, table=True):
    """
    Un APPAREIL branché sur une prise intelligente ESP32.

    `table=True` : cette classe devient une vraie table SQL (nommée "device").
    Sans ce paramètre, ce ne serait qu'un simple modèle de validation, pas une table.
    """

    # `primary_key=True` : ce champ identifie chaque ligne de façon UNIQUE.
    # Ici l'id est une chaîne qu'on choisit nous-mêmes (ex : "kettle-1"), pas un numéro auto.
    id: str = Field(primary_key=True)          # ex : "kettle-1"

    nom: str                                    # nom lisible affiché à l'écran, ex : "Bouilloire"
    prise_id: str                               # identifiant de la prise physique associée

    # Valeur par défaut : si on ne précise rien, un appareil est en "confort".
    # Le type Priorite garantit qu'on ne peut y mettre qu'une des 3 valeurs autorisées.
    priorite: Priorite = Priorite.confort

    etat: str = "on"                            # état courant : "on" (allumé) ou "off" (éteint)
    conso_w: float = 0.0                         # dernière puissance mesurée, en watts

    # `Optional[str]` = soit une chaîne, soit None (rien). Renseigné seulement si l'appareil
    # a été DÉCALÉ : contient l'heure de rallumage prévue. None tant qu'il n'est pas décalé.
    replanifie_a: str | None = None


class Measurement(SQLModel, table=True):
    """
    Une MESURE de consommation envoyée par une prise : "à tel instant, tel appareil
    consommait tant de watts". C'est l'historique brut qui alimente les courbes et,
    plus tard, les prévisions de consommation.
    """

    # Clé primaire AUTO-INCRÉMENTÉE : `default=None` + primary_key => la base attribue
    # elle-même un numéro croissant (1, 2, 3, ...). Optional car il est vide avant l'insertion.
    id: int | None = Field(default=None, primary_key=True)

    # `index=True` : crée un INDEX sur cette colonne => les recherches par appareil
    # (ex : "toutes les mesures de kettle-1") sont beaucoup plus rapides.
    device_id: str = Field(index=True)

    watts: float                                # puissance mesurée, en watts

    # `default_factory=datetime.utcnow` : si on ne fournit pas d'horodatage, on met
    # automatiquement l'heure actuelle (UTC) au moment de la création de la mesure.
    # On passe la FONCTION (sans parenthèses) pour qu'elle soit appelée à CHAQUE insertion.
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class Decision(SQLModel, table=True):
    """
    Une DÉCISION prise par l'IA sur un appareil, AVEC son explication en langage clair.
    Garder une trace de chaque décision est un point fort du projet (critère CA3 :
    "l'IA explique ses choix") et sert au journal affiché dans l'application.
    """

    id: int | None = Field(default=None, primary_key=True)  # clé auto-incrémentée
    device_id: str = Field(index=True)                          # l'appareil concerné

    # L'action retenue (couper / rallumer / garder), typée par l'énumération Action.
    action: Action

    # L'EXPLICATION en français destinée à l'utilisateur/au jury (ex : "J'ai coupé la
    # bouilloire car elle n'est pas essentielle et nous sommes en heure de pointe").
    raison: str

    replanifie_a: str | None = None                          # heure de rallumage si décalé

    # Quand la décision a été prise (rempli automatiquement, comme pour Measurement).
    timestamp: datetime = Field(default_factory=datetime.utcnow)
