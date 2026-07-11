"""Connexion SQLite (ADR-004).

⚡ WAL activé : sans lui, la boucle de polling (une écriture par seconde) et les lectures
(dashboard, prédictions) se bloquaient mutuellement (busy_timeout ~5 s), ce qui gelait le
serveur et rendait les boutons/ordres très lents. En WAL, lecteurs et écrivain sont concurrents.
"""
from sqlalchemy import event
from sqlmodel import Session, SQLModel, create_engine

from .config import settings

engine = create_engine(
    settings.database_url,
    echo=False,
    connect_args={"check_same_thread": False, "timeout": 3},
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragmas(dbapi_conn, _record) -> None:
    """Applique les PRAGMA de performance/concurrence à chaque nouvelle connexion SQLite."""
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")    # lecteurs + écrivain concurrents, sans blocage
    cur.execute("PRAGMA synchronous=NORMAL")  # rapide et sûr sous WAL
    cur.execute("PRAGMA busy_timeout=3000")   # au pire attendre 3 s un verrou (au lieu de figer)
    cur.close()


def init_db() -> None:
    SQLModel.metadata.create_all(engine)


def get_session() -> Session:
    return Session(engine)
