"""Configuración de la base de datos (SQLAlchemy 2.x).

Soporta PostgreSQL en producción (`DATABASE_URL`) y SQLite como
alternativa de desarrollo/pruebas si no se define la variable.
"""

from collections.abc import Iterator

from sqlalchemy import create_engine, inspect, text
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
    """Crea las tablas si no existen y aplica migraciones ligeras."""
    import models  # noqa: F401  (registra los modelos en el metadata)

    Base.metadata.create_all(bind=engine)
    migrate_schema()


def migrate_schema() -> None:
    """Añade columnas nuevas a tablas existentes (compatibilidad multi-proveedor).

    `create_all` no altera tablas ya creadas, así que añadimos manualmente las
    columnas de identidad (Google) y de contraseña, y permitimos `discord_id`
    nulo en bases de datos que ya existían antes de soportar varios métodos.
    """
    inspector = inspect(engine)
    if "users" not in inspector.get_table_names():
        return

    columns = {column["name"]: column for column in inspector.get_columns("users")}
    dialect = engine.dialect.name

    statements: list[str] = []
    if "google_id" not in columns:
        statements.append("ALTER TABLE users ADD COLUMN google_id VARCHAR(64)")
    if "password_hash" not in columns:
        statements.append("ALTER TABLE users ADD COLUMN password_hash VARCHAR(255)")
    if dialect == "postgresql" and not columns.get("discord_id", {}).get("nullable", True):
        statements.append("ALTER TABLE users ALTER COLUMN discord_id DROP NOT NULL")

    existing_indexes = {index["name"] for index in inspector.get_indexes("users")}
    index_statements: list[str] = []
    if "ix_users_google_id" not in existing_indexes:
        index_statements.append(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_google_id ON users (google_id)"
        )

    if not statements and not index_statements:
        return

    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))
        for statement in index_statements:
            connection.execute(text(statement))
