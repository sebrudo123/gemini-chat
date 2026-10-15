"""Autenticación en dos pasos (TOTP) y verificación de correo

Revision ID: 20251016_003
Revises: 20251015_002
Create Date: 2025-10-16 00:10:00

"""
from alembic import op
import sqlalchemy as sa

revision = "20251016_003"
down_revision = "20251015_002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("email_verified", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column("users", sa.Column("totp_secret", sa.String(length=64), nullable=True))
    op.add_column(
        "users",
        sa.Column("totp_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column("users", sa.Column("recovery_codes", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "recovery_codes")
    op.drop_column("users", "totp_enabled")
    op.drop_column("users", "totp_secret")
    op.drop_column("users", "email_verified")
