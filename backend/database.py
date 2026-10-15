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
    """Añade columnas nuevas a tablas existentes (compatibilidad multi-login).

    `create_all` no altera tablas ya creadas, así que añadimos manualmente la
    columna de contraseña y permitimos `discord_id` nulo en bases de datos que
    ya existían antes de soportar el login por correo/contraseña.
    """
    inspector = inspect(engine)
    if "users" not in inspector.get_table_names():
        return

    columns = {column["name"]: column for column in inspector.get_columns("users")}
    dialect = engine.dialect.name

    statements: list[str] = []
    if "password_hash" not in columns:
        statements.append("ALTER TABLE users ADD COLUMN password_hash VARCHAR(255)")
    if "is_active" not in columns:
        statements.append("ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT true")
        statements.append("UPDATE users SET is_active = true WHERE is_active IS NULL")
    if "is_banned" not in columns:
        statements.append("ALTER TABLE users ADD COLUMN is_banned BOOLEAN DEFAULT false")
        statements.append("UPDATE users SET is_banned = false WHERE is_banned IS NULL")
    if "email_verified" not in columns:
        statements.append("ALTER TABLE users ADD COLUMN email_verified BOOLEAN DEFAULT false")
        statements.append("UPDATE users SET email_verified = false WHERE email_verified IS NULL")
    if "totp_secret" not in columns:
        statements.append("ALTER TABLE users ADD COLUMN totp_secret VARCHAR(64)")
    if "totp_enabled" not in columns:
        statements.append("ALTER TABLE users ADD COLUMN totp_enabled BOOLEAN DEFAULT false")
        statements.append("UPDATE users SET totp_enabled = false WHERE totp_enabled IS NULL")
    if "recovery_codes" not in columns:
        statements.append("ALTER TABLE users ADD COLUMN recovery_codes TEXT")
    if "notes" not in columns:
        statements.append("ALTER TABLE users ADD COLUMN notes TEXT")
    if "tags" not in columns:
        statements.append("ALTER TABLE users ADD COLUMN tags VARCHAR(255)")
    if "session_epoch" not in columns:
        statements.append("ALTER TABLE users ADD COLUMN session_epoch INTEGER DEFAULT 0")
        statements.append("UPDATE users SET session_epoch = 0 WHERE session_epoch IS NULL")
    if "role" not in columns:
        statements.append("ALTER TABLE users ADD COLUMN role VARCHAR(32)")
        statements.append("UPDATE users SET role = 'user' WHERE role IS NULL")
    if dialect == "postgresql" and not columns.get("discord_id", {}).get("nullable", True):
        statements.append("ALTER TABLE users ALTER COLUMN discord_id DROP NOT NULL")

    if not statements:
        return

    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))
