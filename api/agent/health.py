"""GET /api/agent/health — valida la clave y lista las herramientas."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from lib.agent_app import app  # noqa: E402,F401
