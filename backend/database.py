"""Configuración de la base de datos (SQLAlchemy 2.x).

Soporta PostgreSQL en producción (`DATABASE_URL`) y SQLite como
alternativa de desarrollo/pruebas si no se define la variable.
"""

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from config import settings


def normalize_url(url: str) -> str:
    """Normaliza la URL para usar el driver psycopg (v3)."""
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+psycopg://", 1)
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


DATABASE_URL = normalize_url(settings.database_url)
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, pool_pre_ping=True, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


class Base(DeclarativeBase):
    """Base declarativa de todos los modelos."""


def get_db() -> Iterator[Session]:
    """Dependencia de FastAPI que provee una sesión de base de datos."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Crea las tablas si no existen."""
    import models  # noqa: F401  (registra los modelos en el metadata)

    Base.metadata.create_all(bind=engine)
